const DATABASE_NAME = "color-timeline-v1";
const DATABASE_VERSION = 1;
const PROJECTS_STORE = "projects";
const SAMPLES_STORE = "samples";
const PROJECT_INDEX = "projectId";

let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable in this environment"));
  }

  const opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
      }
      let samples;
      if (!db.objectStoreNames.contains(SAMPLES_STORE)) {
        samples = db.createObjectStore(SAMPLES_STORE, { keyPath: ["projectId", "timeKey"] });
      } else {
        samples = request.transaction.objectStore(SAMPLES_STORE);
      }
      if (!samples.indexNames.contains(PROJECT_INDEX)) {
        samples.createIndex(PROJECT_INDEX, PROJECT_INDEX, { unique: false });
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open the color timeline database"));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        databasePromise = undefined;
      };
      resolve(db);
    };
  });
  databasePromise = opening.catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => {
      reject(transaction.error ?? new Error("IndexedDB transaction was aborted"));
    }, { once: true });
    transaction.addEventListener("error", () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    }, { once: true });
  });
}

async function runTransaction(storeNames, mode, operation) {
  const db = await openDatabase();
  const transaction = db.transaction(storeNames, mode);
  const done = transactionDone(transaction);
  let result;
  try {
    result = Promise.resolve(operation(transaction));
  } catch (error) {
    result = Promise.reject(error);
  }
  const [value] = await Promise.all([result, done]);
  return value;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function isFileSystemFileHandle(value) {
  return value !== null && typeof value === "object" && value.kind === "file" &&
    typeof value.name === "string" && typeof value.getFile === "function";
}

function isBinaryPayload(value) {
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return true;
  if (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer) return true;
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  const tag = Object.prototype.toString.call(value);
  return tag === "[object Blob]" || tag === "[object File]" || tag === "[object ArrayBuffer]";
}

const OMIT = Symbol("omit");
const MEDIA_PAYLOAD_FIELD = /^(?:source)?(?:file|blob|video|media|image)(?:bytes?|data|contents?)$/i;

function copyMetadata(value, seen = new WeakMap(), fieldName = "") {
  if (value === null || typeof value === "string" || typeof value === "number" ||
      typeof value === "boolean" || typeof value === "bigint") return value;
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return OMIT;
  if (isFileSystemFileHandle(value)) return value;
  if (isBinaryPayload(value) || MEDIA_PAYLOAD_FIELD.test(fieldName)) return OMIT;
  if (value instanceof Date) return new Date(value.getTime());
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const array = [];
    seen.set(value, array);
    for (const entry of value) {
      const copied = copyMetadata(entry, seen);
      if (copied !== OMIT) array.push(copied);
    }
    return array;
  }

  const record = {};
  seen.set(value, record);
  for (const [key, entry] of Object.entries(value)) {
    const copied = copyMetadata(entry, seen, key);
    if (copied !== OMIT) record[key] = copied;
  }
  return record;
}

function createProjectId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Return all project metadata records, including any stored file handles. */
export function listProjects() {
  return runTransaction(PROJECTS_STORE, "readonly", (transaction) =>
    requestResult(transaction.objectStore(PROJECTS_STORE).getAll()));
}

/** Return a project record, or null when the id is not present. */
export function getProject(id) {
  return runTransaction(PROJECTS_STORE, "readonly", (transaction) =>
    requestResult(transaction.objectStore(PROJECTS_STORE).get(id)).then((project) => project ?? null));
}

/** Store metadata and an optional FileSystemFileHandle; media bytes are omitted. */
export async function putProject(project) {
  if (project === null || typeof project !== "object" || Array.isArray(project)) {
    throw new TypeError("project must be a metadata object");
  }
  const record = copyMetadata(project);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("project metadata could not be stored");
  }
  const id = record.id === undefined || record.id === null || record.id === "" ? createProjectId() : record.id;
  record.id = id;
  await runTransaction(PROJECTS_STORE, "readwrite", (transaction) =>
    requestResult(transaction.objectStore(PROJECTS_STORE).put(record)));
  return id;
}

/** Store a timestamped color sample without retaining any image or video data. */
export function putSample(projectId, sample) {
  if (sample === null || typeof sample !== "object" || Array.isArray(sample)) {
    return Promise.reject(new TypeError("sample must be an object"));
  }
  if (!Number.isSafeInteger(sample.timeKey)) {
    return Promise.reject(new TypeError("sample.timeKey must be an integer millisecond value"));
  }
  if (typeof sample.t !== "number" || !Number.isFinite(sample.t)) {
    return Promise.reject(new TypeError("sample.t must be a finite number of seconds"));
  }
  if (!Array.isArray(sample.palette)) {
    return Promise.reject(new TypeError("sample.palette must be an array"));
  }
  const palette = copyMetadata(sample.palette);
  const record = { projectId, timeKey: sample.timeKey, t: sample.t, palette };
  return runTransaction(SAMPLES_STORE, "readwrite", (transaction) =>
    requestResult(transaction.objectStore(SAMPLES_STORE).put(record)));
}

/** Return a project's samples ordered by their integer millisecond timeKey. */
export function getSamples(projectId) {
  return runTransaction(SAMPLES_STORE, "readonly", (transaction) => {
    const index = transaction.objectStore(SAMPLES_STORE).index(PROJECT_INDEX);
    return requestResult(index.getAll(IDBKeyRange.only(projectId)));
  });
}

function deleteSamplesForProject(transaction, projectId) {
  return new Promise((resolve, reject) => {
    const index = transaction.objectStore(SAMPLES_STORE).index(PROJECT_INDEX);
    const request = index.openKeyCursor(IDBKeyRange.only(projectId));
    request.onerror = () => reject(request.error ?? new Error("Could not enumerate project samples"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      transaction.objectStore(SAMPLES_STORE).delete(cursor.primaryKey);
      cursor.continue();
    };
  });
}

/** Atomically delete the project metadata and all of its samples. */
export function deleteProject(id) {
  return runTransaction([PROJECTS_STORE, SAMPLES_STORE], "readwrite", (transaction) => {
    transaction.objectStore(PROJECTS_STORE).delete(id);
    return deleteSamplesForProject(transaction, id);
  });
}
