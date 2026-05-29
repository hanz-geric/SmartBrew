import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './config';

export async function uploadProductImage(localUri: string, productKey: string): Promise<string> {
  // fetch() in Expo returns a native Blob (backed by the file on disk) rather than
  // an in-memory Blob, so uploadBytes can use it without hitting React Native's
  // "Creating blobs from ArrayBuffer is not supported" limitation.
  const response = await fetch(localUri);
  const blob = await response.blob();
  const storageRef = ref(storage, `product-images/${productKey}`);
  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
  return getDownloadURL(storageRef);
}

export async function deleteProductImage(imageUrl: string): Promise<void> {
  try {
    const storageRef = ref(storage, imageUrl);
    await deleteObject(storageRef);
  } catch {
    // no-op if file doesn't exist or URL isn't a storage ref
  }
}
