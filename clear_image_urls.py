"""
Sets image field to null on all product documents in Firestore.
Run: python clear_image_urls.py
"""
import requests

FIREBASE_API_KEY = 'AIzaSyBg5-qNyy7n6YfdJEaWQCLaQhubDsnldEM'
FIREBASE_PROJECT = 'smartbrew-pos'
FIREBASE_EMAIL   = 'admin@smartbrew.app'
FIREBASE_PASSWORD= 'Admin@1234'

FS_BASE = f'https://firestore.googleapis.com/v1/projects/{FIREBASE_PROJECT}/databases/(default)/documents'

def get_token():
    r = requests.post(
        f'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_API_KEY}',
        json={'email': FIREBASE_EMAIL, 'password': FIREBASE_PASSWORD, 'returnSecureToken': True},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()['idToken']

def auth_headers(token):
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

def list_product_ids(token):
    ids = []
    page_token = None
    while True:
        params = {'pageSize': 300}
        if page_token:
            params['pageToken'] = page_token
        r = requests.get(f'{FS_BASE}/products', params=params, headers=auth_headers(token), timeout=15)
        r.raise_for_status()
        data = r.json()
        for doc in data.get('documents', []):
            ids.append(doc['name'].split('/')[-1])
        page_token = data.get('nextPageToken')
        if not page_token:
            break
    return ids

def clear_image(token, doc_id):
    url = f'{FS_BASE}/products/{doc_id}?updateMask.fieldPaths=image'
    body = {'fields': {'image': {'nullValue': None}}}
    r = requests.patch(url, json=body, headers=auth_headers(token), timeout=15)
    return r.ok

token = get_token()
print('Authenticated.')

ids = list_product_ids(token)
print(f'Found {len(ids)} products.')

ok = fail = 0
for pid in ids:
    if clear_image(token, pid):
        ok += 1
    else:
        print(f'  FAIL {pid}')
        fail += 1

print(f'Done. cleared={ok}  failed={fail}')
