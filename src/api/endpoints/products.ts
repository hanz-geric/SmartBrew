import client from '../client';
import { Product } from '../../types';

export async function fetchProducts(): Promise<Product[]> {
  const params = new URLSearchParams();
  params.append('action', 'getProducts');

  const { data } = await client.post<{ status: string; products: Product[] }>(
    '/controllers/cashierController.php',
    params,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  if (data.status !== 'success') throw new Error('Failed to load products');
  return data.products;
}
