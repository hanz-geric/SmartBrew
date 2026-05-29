import { deleteObject, getDownloadURL, ref, uploadString } from 'firebase/storage';
import * as FileSystem from 'expo-file-system/legacy';
import { storage } from './config';

export async function uploadProductImage(localUri: string, productKey: string): Promise<string> {
  // expo-image-picker returns content:// URIs on Android which fetch() cannot read.
  // Use expo-file-system to read the file as base64, then upload via uploadString.
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const storageRef = ref(storage, `product-images/${productKey}`);
  await uploadString(storageRef, base64, 'base64', { contentType: 'image/jpeg' });
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
