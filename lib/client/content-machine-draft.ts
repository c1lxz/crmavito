"use client";

export type ContentMachineDraft = {
  mode: "product-photo" | "original-design";
  imageSize: "2K" | "4K";
  inspirationQuery: string;
  designNote: string;
  labelStyleReference: string;
  products: Array<{ id: string; file: File }>;
  savedAt: string;
};

const databaseName = "crmavito-content-machine";
const storeName = "drafts";
const draftKey = "current";

export async function loadContentMachineDraft(): Promise<ContentMachineDraft | null> {
  const database = await openDatabase();
  return new Promise<ContentMachineDraft | null>((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).get(draftKey);
    request.onsuccess = () => resolve((request.result as ContentMachineDraft | undefined) || null);
    request.onerror = () => reject(request.error || new Error("Не удалось прочитать черновик."));
  }).finally(() => database.close());
}

export async function saveContentMachineDraft(draft: ContentMachineDraft) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(draft, draftKey);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Не удалось сохранить черновик."));
  }).finally(() => database.close());
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB недоступна."));
  });
}
