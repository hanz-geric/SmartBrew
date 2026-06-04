"""
Deletes all product images from Firebase Storage by known product key names.
Run: python clear_images.py
"""
import requests, urllib.parse

FIREBASE_API_KEY = 'AIzaSyBg5-qNyy7n6YfdJEaWQCLaQhubDsnldEM'
FIREBASE_BUCKET  = 'smartbrew-pos.firebasestorage.app'
FIREBASE_EMAIL   = 'admin@smartbrew.app'
FIREBASE_PASSWORD= 'Admin@1234'

ST_BASE = f'https://firebasestorage.googleapis.com/v0/b/{FIREBASE_BUCKET}'

PRODUCT_IDS = [
    # Espresso-based
    'esp-americano','esp-latte','esp-cappuccino','esp-mocha','esp-caramel-mac',
    'esp-vanilla-lat','esp-hazelnut-lat','esp-espresso','esp-double-esp',
    # Cold Brew
    'cb-classic','cb-vanilla','cb-caramel','cb-mocha',
    # Non-Coffee
    'nc-matcha-lat','nc-ube-lat','nc-choco','nc-taro-lat','nc-strawberry-lat',
    'nc-salted-caramel','nc-vanilla-bean',
    # Frappuccino
    'frapp-mocha','frapp-caramel','frapp-vanilla','frapp-matcha','frapp-ube',
    # Frappe
    'frappe-choco-hazel','frappe-salt-caramel','frappe-oreo-cheese','frappe-biscoff',
    # Cream Frappe
    'cream-oreo-cheese','cream-cnc','cream-choco-hazel','cream-blueberry',
    'cream-biscoff','cream-strawberry','cream-salt-caramel','cream-matcha',
    # Milktea
    'mt-okinawa','mt-red-velvet','mt-wintermelon','mt-cnc','mt-strawberry',
    'mt-ube','mt-cheesecake','mt-taro',
    # Tea Collection
    'tea-green','tea-hibiscus','tea-chamomile','tea-peach-oo','tea-merry-berry',
    # Fruit Teas
    'ft-kiwi','ft-blueberry','ft-green-apple','ft-strawberry','ft-lychee','ft-peach',
    # Fizz and Ades
    'blush-bloom','lemon-lime','sakura-lychee',
    # Mango Delights
    'mango-sticky-sm','mango-sticky-cup','mango-smoothie','matcha-mango',
    # Snacks
    'chicken-nuggets','spring-rolls','chicken-poppers','churros-classic',
    'churros-savory','nachos-classic','nachos-overload','fries',
    # Waffles
    'waffle-blueberry','waffle-choco-alca','waffle-biscoff-al','waffle-biscoff-cr',
    # Chicken Wings
    'wings-4pc','wings-4pc-side','wings-5pc-classic',
    # Pasta
    'shrimp-carbonara','buffalo-pasta','carbonara','pesto-pasta','cajun-chicken-pa',
    # Bundles
    'bundle-1','bundle-2','bundle-3','bundle-4','bundle-5','bundle-6',
    # Desserts & Others
    'halo-halo','mineral-water',
]

def get_token():
    r = requests.post(
        f'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_API_KEY}',
        json={'email': FIREBASE_EMAIL, 'password': FIREBASE_PASSWORD, 'returnSecureToken': True},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()['idToken']

def delete_file(token, obj_path):
    encoded = urllib.parse.quote(obj_path, safe='')
    url = f'{ST_BASE}/o/{encoded}'
    r = requests.delete(url, headers={'Authorization': f'Bearer {token}'}, timeout=15)
    return r.status_code

token = get_token()
print('Authenticated.')

deleted = skipped = errors = 0
for pid in PRODUCT_IDS:
    obj = f'product-images/{pid}.png'
    status = delete_file(token, obj)
    if status in (200, 204):
        print(f'  DEL {obj}')
        deleted += 1
    elif status == 404:
        skipped += 1
    else:
        print(f'  ERR {status} {obj}')
        errors += 1

print(f'\nDone. deleted={deleted}  not_found={skipped}  errors={errors}')

