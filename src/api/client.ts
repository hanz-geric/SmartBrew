import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL, API_TIMEOUT_MS, TOKEN_KEY } from '../constants/config';

const client: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT on every request
client.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Unwrap axios errors into a plain message
client.interceptors.response.use(
  (res) => res,
  (err) => {
    const message: string =
      err?.response?.data?.message ??
      err?.message ??
      'Network error';
    return Promise.reject(new Error(message));
  },
);

export default client;
