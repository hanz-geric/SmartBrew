import { deleteObject, getDownloadURL, ref } from 'firebase/storage';
import { getAuth } from 'firebase/auth';
import * as FileSystem from 'expo-file-system/legacy';
import { storage } from './config';

export async function uploadProductImage(localUri: string, productKey: string): Promise<string> {
  // The Firebase Storage JS SDK internally calls new Blob([ArrayBuffer]) which
  // React Native's Blob polyfill does not support. Bypass it entirely by uploading
  // via expo-file-system uploadAsync → native HTTP → Firebase Storage REST API.
  const auth = getAuth();
  if (!auth.currentUser) throw new Error('Not authenticated');

  const idToken  = await auth.currentUser.getIdToken();
  const bucket   = storage.app.options.storageBucket!;
  const objPath  = `product-images/${productKey}`;
  const uploadUrl =
    `https://firebasestorage.googleapis.com/v0/b/${bucket}/o` +
    `?uploadType=media&name=${encodeURIComponent(objPath)}`;

  const result = await FileSystem.uploadAsync(uploadUrl, localUri, {
    httpMethod:  'POST',
    uploadType:  FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'image/jpeg',
    },
  });

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed (${result.status})`);
  }

  return getDownloadURL(ref(storage, objPath));
}

export async function deleteProductImage(imageUrl: string): Promise<void> {
  try {
    const storageRef = ref(storage, imageUrl);
    await deleteObject(storageRef);
  } catch {
    // no-op if file doesn't exist or URL isn't a storage ref
  }
}
