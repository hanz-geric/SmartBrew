"""
SmartBrew Firestore + Firebase Storage seeder.
Run:  python seed.py
"""

import os, sys, time, json, requests, urllib.parse, tempfile
os.environ.setdefault('NUMBA_CACHE_DIR', tempfile.gettempdir())
from pathlib import Path
from rembg import remove

# ── Config ────────────────────────────────────────────────────────────────────
FIREBASE_API_KEY  = 'AIzaSyBg5-qNyy7n6YfdJEaWQCLaQhubDsnldEM'
FIREBASE_PROJECT  = 'smartbrew-pos'
FIREBASE_BUCKET   = 'smartbrew-pos.firebasestorage.app'
FIREBASE_EMAIL    = 'admin@smartbrew.app'
FIREBASE_PASSWORD = 'Admin@1234'
PEXELS_API_KEY    = 'rMfJAfQVItoNLE7yKY5RIkjtdbsRCFYR4QS9tm7D49vgFZ8yiQA9JuYX'

FS_BASE = f'https://firestore.googleapis.com/v1/projects/{FIREBASE_PROJECT}/databases/(default)/documents'
ST_BASE = f'https://firebasestorage.googleapis.com/v0/b/{FIREBASE_BUCKET}'

IMAGES_DIR = Path(__file__).parent / 'seed_images'
IMAGES_DIR.mkdir(exist_ok=True)

# ── Firebase Auth ─────────────────────────────────────────────────────────────
_token      = None
_token_time = 0

def get_token(force=False):
    global _token, _token_time
    if not force and _token and (time.time() - _token_time) < 3000:
        return _token
    r = requests.post(
        f'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_API_KEY}',
        json={'email': FIREBASE_EMAIL, 'password': FIREBASE_PASSWORD, 'returnSecureToken': True},
        timeout=15,
    )
    r.raise_for_status()
    _token      = r.json()['idToken']
    _token_time = time.time()
    return _token

def auth_headers():
    return {'Authorization': f'Bearer {get_token()}', 'Content-Type': 'application/json'}

# ── Firestore helpers ─────────────────────────────────────────────────────────
def _wrap(v):
    if v is None:           return {'nullValue': None}
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int):  return {'integerValue': str(v)}
    if isinstance(v, float):return {'doubleValue': v}
    if isinstance(v, str):  return {'stringValue': v}
    if isinstance(v, list): return {'arrayValue': {'values': [_wrap(i) for i in v]}}
    if isinstance(v, dict): return {'mapValue': {'fields': {k: _wrap(x) for k, x in v.items()}}}
    return {'stringValue': str(v)}

def to_doc(data): return {'fields': {k: _wrap(v) for k, v in data.items()}}

def fs_set(col, doc_id, data, retries=3):
    url = f'{FS_BASE}/{col}/{doc_id}'
    for attempt in range(retries):
        try:
            r = requests.patch(url, json=to_doc(data), headers=auth_headers(), timeout=15)
            if r.status_code == 401:
                get_token(force=True)
                continue
            r.raise_for_status()
            return
        except Exception as e:
            if attempt == retries - 1: raise
            time.sleep(1)

def fs_list_ids(col):
    ids, page_token = [], None
    while True:
        params = {'pageSize': 300}
        if page_token: params['pageToken'] = page_token
        r = requests.get(f'{FS_BASE}/{col}', params=params, headers=auth_headers(), timeout=15)
        if r.status_code == 404: return []
        r.raise_for_status()
        data = r.json()
        for doc in data.get('documents', []):
            ids.append(doc['name'].split('/')[-1])
        page_token = data.get('nextPageToken')
        if not page_token: break
    return ids

def fs_delete(col, doc_id):
    r = requests.delete(f'{FS_BASE}/{col}/{doc_id}', headers=auth_headers(), timeout=10)
    if r.status_code not in (200, 204, 404): r.raise_for_status()

def clear_collection(col):
    print(f'  Clearing {col}...', end=' ', flush=True)
    ids = fs_list_ids(col)
    for doc_id in ids:
        fs_delete(col, doc_id)
    print(f'{len(ids)} docs deleted.')

# ── Firebase Storage ──────────────────────────────────────────────────────────
def upload_image(local_path: Path, product_key: str) -> str:
    obj   = f'product-images/{product_key}.png'
    enc   = urllib.parse.quote(obj, safe='')
    url   = f'{ST_BASE}/o?uploadType=media&name={enc}'
    data  = local_path.read_bytes()
    r = requests.post(url, data=data, headers={
        'Authorization': f'Bearer {get_token()}',
        'Content-Type': 'image/png',
    }, timeout=60)
    if r.status_code == 401:
        get_token(force=True)
        r = requests.post(url, data=data, headers={
            'Authorization': f'Bearer {get_token()}',
            'Content-Type': 'image/png',
        }, timeout=60)
    r.raise_for_status()
    token = r.json().get('downloadTokens', '')
    return f'https://firebasestorage.googleapis.com/v0/b/{FIREBASE_BUCKET}/o/{enc}?alt=media&token={token}'

# ── Pexels ────────────────────────────────────────────────────────────────────
def pexels_image_url(query: str, fallback: str = 'food drink') -> str | None:
    for q in [query, fallback]:
        r = requests.get('https://api.pexels.com/v1/search',
            params={'query': q, 'per_page': 1, 'orientation': 'square'},
            headers={'Authorization': PEXELS_API_KEY}, timeout=15)
        r.raise_for_status()
        photos = r.json().get('photos', [])
        if photos:
            return photos[0]['src']['medium']
    return None

def fetch_and_process(product_id: str, query: str) -> Path | None:
    out_png = IMAGES_DIR / f'{product_id}.png'
    if out_png.exists():
        return out_png  # already processed

    raw_jpg = IMAGES_DIR / f'{product_id}_raw.jpg'
    try:
        url = pexels_image_url(query)
        if not url:
            print(f'    [WARN] No Pexels result for "{query}"')
            return None
        img_data = requests.get(url, timeout=30).content
        raw_jpg.write_bytes(img_data)

        out_png.write_bytes(remove(raw_jpg.read_bytes()))
        raw_jpg.unlink(missing_ok=True)
        return out_png
    except Exception as e:
        print(f'    [ERR] {product_id}: {e}')
        if raw_jpg.exists(): raw_jpg.unlink()
        return None

# ── Menu data ─────────────────────────────────────────────────────────────────

CATEGORIES = [
    {'id': 'coffee-based',   'name': 'Coffee-Based',   'sort_order': 0,  'is_active': True},
    {'id': 'non-coffee',     'name': 'Non-Coffee',     'sort_order': 1,  'is_active': True},
    {'id': 'frappe',         'name': 'Frappe',         'sort_order': 2,  'is_active': True},
    {'id': 'milktea',        'name': 'Milktea',        'sort_order': 3,  'is_active': True},
    {'id': 'tea-collection', 'name': 'Tea Collection', 'sort_order': 4,  'is_active': True},
    {'id': 'fruit-teas',     'name': 'Fruit Teas',     'sort_order': 5,  'is_active': True},
    {'id': 'fizz-and-ades',  'name': 'Fizz and Ades',  'sort_order': 6,  'is_active': True},
    {'id': 'mango-delights', 'name': 'Mango Delights', 'sort_order': 7,  'is_active': True},
    {'id': 'snacks',         'name': 'Snacks',         'sort_order': 8,  'is_active': True},
    {'id': 'waffles',        'name': 'Waffles',        'sort_order': 9,  'is_active': True},
    {'id': 'chicken-wings',  'name': 'Chicken Wings',  'sort_order': 10, 'is_active': True},
    {'id': 'pasta',          'name': 'Pasta',          'sort_order': 11, 'is_active': True},
    {'id': 'smart-bundles',  'name': 'Smart Bundles',  'sort_order': 12, 'is_active': True},
    {'id': 'desserts',       'name': 'Desserts',       'sort_order': 13, 'is_active': True},
    {'id': 'others',         'name': 'Others',         'sort_order': 14, 'is_active': True},
]

def mg(id_, name, required, max_sel, sort, modifiers):
    return {'id': id_, 'name': name, 'is_required': required, 'max_select': max_sel,
            'sort_order': sort, 'is_active': True, 'modifiers': modifiers}

def mod(id_, name, delta, sort):
    return {'id': id_, 'name': name, 'price_delta': float(delta),
            'sort_order': sort, 'is_active': True, 'recipe_lines': []}

MODIFIER_GROUPS = {
    'temp_5':  mg('temp-5',  'Temperature', True,  1, 0, [mod('m-t5-hot',  'Hot (12oz)',  0,  0), mod('m-t5-cold',  'Cold (22oz)', 5,  1)]),
    'temp_10': mg('temp-10', 'Temperature', True,  1, 0, [mod('m-t10-hot', 'Hot (12oz)',  0,  0), mod('m-t10-cold', 'Cold (22oz)', 10, 1)]),
    'temp_15': mg('temp-15', 'Temperature', True,  1, 0, [mod('m-t15-hot', 'Hot (12oz)',  0,  0), mod('m-t15-cold', 'Cold (22oz)', 15, 1)]),
    'coffee_addons': mg('coffee-addons', 'Add-Ons', False, 5, 1, [
        mod('m-ca-espresso',    'Espresso',              25, 0),
        mod('m-ca-whip',        'Whipped Cream',         30, 1),
        mod('m-ca-oatmilk',     'Oat Milk',              35, 2),
        mod('m-ca-sy-caramel',  'Syrup - Caramel',       25, 3),
        mod('m-ca-sy-vanilla',  'Syrup - Vanilla',       25, 4),
        mod('m-ca-sy-hazelnut', 'Syrup - Hazelnut',      25, 5),
        mod('m-ca-sy-saltcaram','Syrup - Salted Caramel',25, 6),
        mod('m-ca-cjelly',      'Coffee Jelly',          35, 7),
    ]),
    'tea_addons': mg('tea-addons', 'Add-Ons', False, 5, 1, [
        mod('m-ta-pearl',       'Pearl',        25, 0),
        mod('m-ta-grassjelly',  'Grass Jelly',  25, 1),
        mod('m-ta-pudding',     'Pudding',      35, 2),
        mod('m-ta-cjelly',      'Coffee Jelly', 35, 3),
        mod('m-ta-nata',        'Nata',         25, 4),
        mod('m-ta-boba',        'Popping Boba', 35, 5),
        mod('m-ta-milk',        'Milk',         25, 6),
        mod('m-ta-espresso',    'Espresso',     25, 7),
        mod('m-ta-sauce',       'Sauce/Syrup',  25, 8),
    ]),
    'dip_choice': mg('dip-choice', 'Dip Choice', True, 1, 0, [
        mod('m-dip-swchilli', 'Sweet Chilli', 0, 0),
        mod('m-dip-garlicmayo', 'Garlic Mayo', 0, 1),
    ]),
    'fries_dip': mg('fries-dip', 'Dip', True, 1, 0, [
        mod('m-fd-tomato',    'Tomato Catsup', 0, 0),
        mod('m-fd-garlicmayo','Garlic Mayo',   0, 1),
    ]),
    'fries_seasoning': mg('fries-seasoning', 'Seasoning', True, 1, 1, [
        mod('m-fs-sourcream', 'Sour Cream',    0, 0),
        mod('m-fs-cheese',    'Cheese',        0, 1),
        mod('m-fs-saltpepper','Salt & Pepper', 0, 2),
        mod('m-fs-bbq',       'Bbq',           0, 3),
    ]),
    'wing_flavor': mg('wing-flavor', 'Wing Flavor', True, 1, 0, [
        mod('m-wf-sriracha', 'Sriracha',        0, 0),
        mod('m-wf-garlicparm','Garlic Parmesan',0, 1),
        mod('m-wf-barbeque', 'Barbeque',        0, 2),
    ]),
    'fizz_flavor': mg('fizz-flavor', 'Fizz Ade Flavor', True, 3, 0, [
        mod('m-ff-lychee',      'Lychee',      0, 0),
        mod('m-ff-strawberry',  'Strawberry',  0, 1),
        mod('m-ff-greenapple',  'Green Apple', 0, 2),
        mod('m-ff-peach',       'Peach',       0, 3),
        mod('m-ff-kiwi',        'Kiwi',        0, 4),
    ]),
    'pasta_choice': mg('pasta-choice', 'Pasta Choice', True, 2, 0, [
        mod('m-pc-shrimp',   'Shrimp Carbonara Pasta', 0, 0),
        mod('m-pc-buffalo',  'Buffalo Pasta',          0, 1),
        mod('m-pc-carbonara','Carbonara',              0, 2),
        mod('m-pc-pesto',    'Pesto Pasta',            0, 3),
        mod('m-pc-cajun',    'Cajun Chicken Pasta',    0, 4),
    ]),
    'halo_size': mg('halo-size', 'Size', True, 1, 0, [
        mod('m-hs-16oz', '16oz', 0,  0),
        mod('m-hs-22oz', '22oz', 40, 1),
    ]),
    'water_size': mg('water-size', 'Size', True, 1, 0, [
        mod('m-ws-350ml', '350ml', 0,  0),
        mod('m-ws-500ml', '500ml', 10, 1),
    ]),
}

def p(id_, name, price, cat_id, cat_name, kitchen, mgs, pexels):
    return {'id': id_, 'name': name, 'price': price, 'cost': 0.0,
            'category_id': cat_id, 'category_name': cat_name,
            'tracking_mode': 'none', 'stock_item_id': None,
            'recipe_lines': [], 'image': None,
            'needs_kitchen': kitchen, 'is_active': True,
            'stock_status': 'ok', 'modifier_groups': [],
            '_mgs': mgs, '_pexels': pexels}

CB, NC = 'coffee-based', 'non-coffee'
FR, MT = 'frappe',       'milktea'
TC, FT = 'tea-collection','fruit-teas'
FA, MD = 'fizz-and-ades', 'mango-delights'
SN, WF = 'snacks',       'waffles'
CW, PA = 'chicken-wings','pasta'
SB, DS = 'smart-bundles','desserts'
OT      = 'others'

CBN, NCN = 'Coffee-Based', 'Non-Coffee'
FRN, MTN = 'Frappe',       'Milktea'
TCN, FTN = 'Tea Collection','Fruit Teas'
FAN, MDN = 'Fizz and Ades','Mango Delights'
SNN, WFN = 'Snacks',       'Waffles'
CWN, PAN = 'Chicken Wings','Pasta'
SBN, DSN = 'Smart Bundles','Desserts'
OTN      = 'Others'

PRODUCTS = [
    # ── Coffee-Based ──────────────────────────────────────────────────────────
    p('americano',           'Americano',           95,  CB, CBN, False, ['temp_5',  'coffee_addons'], 'americano black coffee'),
    p('coffee-latte',        'Coffee Latte',        145, CB, CBN, False, ['temp_10', 'coffee_addons'], 'coffee latte cup'),
    p('spanish-latte',       'Spanish Latte',       150, CB, CBN, False, ['temp_10', 'coffee_addons'], 'spanish latte coffee condensed milk'),
    p('mocha',               'Mocha',               155, CB, CBN, False, ['temp_10', 'coffee_addons'], 'mocha coffee chocolate'),
    p('vanilla-latte',       'Vanilla Latte',       155, CB, CBN, False, ['temp_5',  'coffee_addons'], 'vanilla latte coffee'),
    p('white-mocha',         'White Mocha',         160, CB, CBN, False, ['temp_10', 'coffee_addons'], 'white mocha coffee'),
    p('seasalt-latte',       'Seasalt Latte',       160, CB, CBN, False, ['temp_10', 'coffee_addons'], 'sea salt coffee latte'),
    p('caramel-macchiato',   'Caramel Macchiato',   160, CB, CBN, False, ['temp_10', 'coffee_addons'], 'caramel macchiato coffee'),
    p('butterscotch-latte',  'Butterscotch Latte',  160, CB, CBN, False, ['temp_5',  'coffee_addons'], 'butterscotch latte coffee'),
    p('dirty-matcha',        'Dirty Matcha',        160, CB, CBN, False, ['temp_5',  'coffee_addons'], 'dirty matcha latte espresso'),
    p('chocolate-danish',    'Chocolate Danish',    170, CB, CBN, False, ['temp_5',  'coffee_addons'], 'chocolate danish latte coffee'),
    p('the-smart-shot',      'The Smart Shot',      175, CB, CBN, False, ['temp_5',  'coffee_addons'], 'espresso shot signature coffee'),
    p('tiramisu-cloud-latte','Tiramisu Cloud Latte', 185, CB, CBN, False, ['coffee_addons'],            'tiramisu latte cold coffee'),
    # ── Non-Coffee ────────────────────────────────────────────────────────────
    p('ube-latte',           'Ube Latte',           140, NC, NCN, False, ['temp_15', 'coffee_addons'], 'ube purple latte drink'),
    p('strawberry-latte',    'Strawberry Latte',    145, NC, NCN, False, ['temp_10', 'coffee_addons'], 'strawberry latte pink drink'),
    p('ube-quezo-latte',     'Ube Quezo Latte',     150, NC, NCN, False, ['temp_5',  'coffee_addons'], 'ube cheese latte purple'),
    p('chocolate-drink',     'Chocolate',           155, NC, NCN, False, ['temp_5',  'coffee_addons'], 'hot chocolate drink cup'),
    p('matcha-latte',        'Matcha Latte',        200, NC, NCN, False, ['temp_10', 'coffee_addons'], 'matcha latte green tea'),
    p('matcha-strawberry',   'Matcha Strawberry',   220, NC, NCN, False, ['coffee_addons'],            'matcha strawberry iced drink'),
    p('matcha-oatmilk',      'Matcha Oatmilk',      230, NC, NCN, False, ['coffee_addons'],            'matcha oat milk latte'),
    # ── Frappe ────────────────────────────────────────────────────────────────
    p('frappe-choco-hazel',  'Choco Hazelnut Frappe',       209, FR, FRN, False, [], 'chocolate hazelnut frappe whipped cream'),
    p('frappe-salt-caramel', 'Salted Caramel Frappe',       209, FR, FRN, False, [], 'salted caramel frappe whipped cream'),
    p('frappe-oreo-cheese',  'Oreo Cheesecake Frappe',      209, FR, FRN, False, [], 'oreo cheesecake frappe'),
    p('frappe-biscoff',      'Biscoff Frappe',              219, FR, FRN, False, [], 'biscoff cookie frappe'),
    p('cream-oreo-cheese',   'Oreo Cheesecake Cream Frappe',190, FR, FRN, False, [], 'oreo cream frappe blended'),
    p('cream-cnc',           'Cookies & Cream Frappe',      190, FR, FRN, False, [], 'cookies cream frappe blended'),
    p('cream-choco-hazel',   'Choco Hazelnut Cream Frappe', 190, FR, FRN, False, [], 'chocolate hazelnut cream blended'),
    p('cream-blueberry',     'Blueberry Frappe',            185, FR, FRN, False, [], 'blueberry frappe smoothie'),
    p('cream-biscoff',       'Biscoff Cream Frappe',        199, FR, FRN, False, [], 'biscoff cream blended drink'),
    p('cream-strawberry',    'Strawberry & Cream Frappe',   190, FR, FRN, False, [], 'strawberry cream frappe'),
    p('cream-salt-caramel',  'Salted Caramel Chip Frappe',  190, FR, FRN, False, [], 'salted caramel chip frappe'),
    p('cream-matcha',        'Matcha Frappe',               190, FR, FRN, False, [], 'matcha frappe green blended'),
    # ── Milktea ───────────────────────────────────────────────────────────────
    p('mt-okinawa',    'Okinawa Milktea',        120, MT, MTN, False, ['tea_addons'], 'okinawa brown sugar milk tea'),
    p('mt-red-velvet', 'Red Velvet Milktea',     120, MT, MTN, False, ['tea_addons'], 'red velvet milk tea'),
    p('mt-wintermelon','Wintermelon Milktea',    120, MT, MTN, False, ['tea_addons'], 'wintermelon milk tea'),
    p('mt-cnc',        'Cookies & Cream Milktea',120, MT, MTN, False, ['tea_addons'], 'cookies cream milk tea'),
    p('mt-strawberry', 'Strawberry Milktea',     120, MT, MTN, False, ['tea_addons'], 'strawberry milk tea pink'),
    p('mt-ube',        'Ube Milktea',            120, MT, MTN, False, ['tea_addons'], 'ube purple milk tea'),
    p('mt-cheesecake', 'Cheesecake Milktea',     120, MT, MTN, False, ['tea_addons'], 'cheesecake milk tea drink'),
    p('mt-taro',       'Taro Milktea',           120, MT, MTN, False, ['tea_addons'], 'taro milk tea purple'),
    # ── Tea Collection ────────────────────────────────────────────────────────
    p('tea-green',      'Green Tea',         100, TC, TCN, False, ['tea_addons'], 'green tea drink cup'),
    p('tea-hibiscus',   'Hibiscus Dazzler',  100, TC, TCN, False, ['tea_addons'], 'hibiscus tea pink'),
    p('tea-chamomile',  'Chamomile',         100, TC, TCN, False, ['tea_addons'], 'chamomile tea cup'),
    p('tea-peach-oo',   'Peach Oolong',      100, TC, TCN, False, ['tea_addons'], 'peach oolong tea'),
    p('tea-merry-berry','Merry Berry',       100, TC, TCN, False, ['tea_addons'], 'mixed berry tea drink'),
    # ── Fruit Teas ────────────────────────────────────────────────────────────
    p('ft-kiwi',       'Kiwi Fruit Tea',        120, FT, FTN, False, [], 'kiwi fruit tea green'),
    p('ft-blueberry',  'Blueberry Fruit Tea',   120, FT, FTN, False, [], 'blueberry fruit tea'),
    p('ft-green-apple','Green Apple Fruit Tea', 120, FT, FTN, False, [], 'green apple iced tea'),
    p('ft-strawberry', 'Strawberry Fruit Tea',  120, FT, FTN, False, [], 'strawberry fruit tea'),
    p('ft-lychee',     'Lychee Fruit Tea',      120, FT, FTN, False, [], 'lychee tea drink'),
    p('ft-peach',      'Peach Fruit Tea',       120, FT, FTN, False, [], 'peach iced tea'),
    # ── Fizz and Ades ─────────────────────────────────────────────────────────
    p('blush-bloom',     'Blush and Bloom',    120, FA, FAN, False, [], 'hibiscus rose sparkling drink'),
    p('lemon-lime',      'Lemon Lime Bitter',  145, FA, FAN, False, [], 'lemon lime mocktail citrus'),
    p('sakura-lychee',   'Sakura Lychees Fizz',155, FA, FAN, False, [], 'lychee sparkling drink pink'),
    # ── Mango Delights ────────────────────────────────────────────────────────
    p('mango-sticky-sm', 'Mango Sticky Rice Smoothie',230, MD, MDN, False, [], 'mango smoothie yellow'),
    p('mango-sticky-cup','Mango Sticky Rice in a Cup', 189, MD, MDN, True,  [], 'mango sticky rice dessert cup'),
    p('mango-smoothie',  'Mango Smoothie',             199, MD, MDN, False, [], 'mango smoothie tropical'),
    p('matcha-mango',    'Matcha Mango',               240, MD, MDN, False, [], 'matcha mango layered drink'),
    # ── Snacks ────────────────────────────────────────────────────────────────
    p('chicken-nuggets', 'Chicken Nuggets',                    170, SN, SNN, True,  ['dip_choice'],                  'chicken nuggets crispy'),
    p('spring-rolls',    'Spring Rolls',                       150, SN, SNN, True,  ['dip_choice'],                  'spring rolls fried'),
    p('chicken-poppers', 'Chicken Poppers',                    175, SN, SNN, True,  ['dip_choice'],                  'chicken poppers crispy'),
    p('churros-classic', 'Classic Churros with Chocolate Dip', 175, SN, SNN, True,  [],                              'churros chocolate dip'),
    p('churros-savory',  'Savory Churros with Pimiento Dip',   180, SN, SNN, True,  [],                              'churros savory'),
    p('nachos-classic',  'Nachos Classic',                     185, SN, SNN, True,  [],                              'nachos classic chips'),
    p('nachos-overload', 'Nachos Overload',                    210, SN, SNN, True,  [],                              'nachos overload loaded toppings'),
    p('fries',           'Fries',                              150, SN, SNN, True,  ['fries_dip','fries_seasoning'], 'french fries crispy'),
    # ── Waffles ───────────────────────────────────────────────────────────────
    p('waffle-blueberry',  'Blueberry Waffle',       150, WF, WFN, True, [], 'blueberry waffle syrup'),
    p('waffle-choco-alca', 'Choco Alcapone Waffle',  150, WF, WFN, True, [], 'chocolate waffle'),
    p('waffle-biscoff-al', 'Biscoff Alcapone Waffle',150, WF, WFN, True, [], 'biscoff waffle cookie'),
    p('waffle-biscoff-cr', 'Biscoff & Cream Waffle', 160, WF, WFN, True, [], 'waffle whipped cream topping'),
    # ── Chicken Wings ─────────────────────────────────────────────────────────
    p('wings-4pc',        'Chicken Wings 4 pcs',          190, CW, CWN, True, ['wing_flavor'],                'chicken wings sauce'),
    p('wings-4pc-side',   'Chicken Wings 4 pcs w/ Side',  210, CW, CWN, True, ['wing_flavor'],                'chicken wings fries'),
    p('wings-5pc-classic','Chicken Wings 5 pcs Classic',  210, CW, CWN, True, [],                             'crispy chicken wings classic'),
    # ── Pasta ─────────────────────────────────────────────────────────────────
    p('shrimp-carbonara', 'Shrimp Carbonara Pasta',274, PA, PAN, True, [], 'shrimp carbonara pasta creamy'),
    p('buffalo-pasta',    'Buffalo Pasta',         229, PA, PAN, True, [], 'buffalo chicken pasta spicy'),
    p('carbonara',        'Carbonara',             215, PA, PAN, True, [], 'carbonara pasta bacon'),
    p('pesto-pasta',      'Pesto Pasta',           199, PA, PAN, True, [], 'pesto pasta green'),
    p('cajun-chicken-pa', 'Cajun Chicken Pasta',   249, PA, PAN, True, [], 'cajun chicken pasta spicy'),
    # ── Smart Bundles ─────────────────────────────────────────────────────────
    p('bundle-1','Bundle 1',  297,  SB, SBN, True, ['wing_flavor','fizz_flavor'],                   'chicken wings fries meal combo'),
    p('bundle-2','Bundle 2',  486,  SB, SBN, True, ['fries_seasoning','fizz_flavor'],               'spring rolls fries drinks combo'),
    p('bundle-3','Bundle 3',  625,  SB, SBN, True, ['fries_seasoning','fizz_flavor'],               'nachos fries drinks party food'),
    p('bundle-4','Bundle 4',  677,  SB, SBN, True, ['fries_seasoning','fizz_flavor'],               'chicken nuggets fries drinks combo'),
    p('bundle-5','Bundle 5',  697,  SB, SBN, True, ['pasta_choice','wing_flavor','fizz_flavor'],    'pasta chicken wings drinks combo'),
    p('bundle-6','Bundle 6',  1380, SB, SBN, True, ['pasta_choice','wing_flavor'],                  'party food platter pasta wings'),
    # ── Desserts ──────────────────────────────────────────────────────────────
    p('halo-halo',    'Halo Halo',     80,  DS, DSN, True,  ['halo_size'],  'halo halo Filipino dessert ice'),
    # ── Others ────────────────────────────────────────────────────────────────
    p('mineral-water','Mineral Water', 20,  OT, OTN, False, ['water_size'], 'mineral water bottle'),
]

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print('SmartBrew Firestore Seeder')
    print('=' * 50)

    # 1. Auth
    print('\n[1] Authenticating with Firebase...')
    get_token()
    print('    OK')

    # 2. Clear collections
    print('\n[2] Clearing Firestore collections...')
    for col in ['products', 'categories', 'modifier_groups', 'orders', 'cash_sessions']:
        clear_collection(col)

    # 3. Images: download → rembg → upload
    print(f'\n[3] Processing {len(PRODUCTS)} product images...')
    image_urls = {}
    for i, prod in enumerate(PRODUCTS, 1):
        pid   = prod['id']
        query = prod['_pexels']
        print(f'  [{i:02d}/{len(PRODUCTS)}] {prod["name"]}', end=' ... ', flush=True)

        png = fetch_and_process(pid, query)
        if png:
            try:
                url = upload_image(png, pid)
                image_urls[pid] = url
                print('uploaded OK')
            except Exception as e:
                print(f'upload FAILED: {e}')
        else:
            print('image SKIPPED')
        time.sleep(0.3)  # polite rate limiting

    # 4. Seed categories
    print(f'\n[4] Seeding {len(CATEGORIES)} categories...')
    for cat in CATEGORIES:
        fs_set('categories', cat['id'], {k: v for k, v in cat.items() if k != 'id'})
        print(f'    {cat["name"]} OK')

    # 5. Seed modifier groups (standalone collection)
    print(f'\n[5] Seeding {len(MODIFIER_GROUPS)} modifier groups...')
    for key, mg_data in MODIFIER_GROUPS.items():
        doc = {k: v for k, v in mg_data.items() if k != 'id'}
        fs_set('modifier_groups', mg_data['id'], doc)
        print(f'    {mg_data["name"]} ({mg_data["id"]}) OK')

    # 6. Seed products
    print(f'\n[6] Seeding {len(PRODUCTS)} products...')
    for prod in PRODUCTS:
        pid  = prod['id']
        mgs  = [MODIFIER_GROUPS[k] for k in prod['_mgs']]
        data = {
            'name':            prod['name'],
            'price':           float(prod['price']),
            'cost':            0.0,
            'category_id':     prod['category_id'],
            'category_name':   prod['category_name'],
            'tracking_mode':   prod['tracking_mode'],
            'stock_item_id':   prod['stock_item_id'],
            'recipe_lines':    prod['recipe_lines'],
            'image':           image_urls.get(pid),
            'needs_kitchen':   prod['needs_kitchen'],
            'is_active':       prod['is_active'],
            'stock_status':    prod['stock_status'],
            'modifier_groups': mgs,
        }
        fs_set('products', pid, data)
        print(f'    {prod["name"]} OK')

    print('\n' + '=' * 50)
    print(f'Done! {len(PRODUCTS)} products seeded, {len(image_urls)} images uploaded.')
    missing = [p['id'] for p in PRODUCTS if p['id'] not in image_urls]
    if missing:
        print(f'Images missing ({len(missing)}): {", ".join(missing)}')

if __name__ == '__main__':
    main()
