export type UserRole      = 'admin' | 'manager' | 'cashier';
export type PaymentMethod = 'cash' | 'card' | 'qr' | 'gift_card';
export type OrderStatus   = 'pending' | 'completed' | 'cancelled';
export type OrderType     = 'dine_in' | 'takeaway' | 'delivery';
export type TrackingMode  = 'none' | 'direct' | 'recipe';
export type StockStatus   = 'ok' | 'low' | 'out';

// ─── Cashier Roster & Attendance ──────────────────────────────────────────────

export type CashierAction = 'open' | 'clock_in' | 'switch_in' | 'switch_out' | 'clock_out';

export interface CashierEvent {
  uid:       string;
  username:  string;
  full_name: string;
  role:      UserRole;
  action:    CashierAction;
  at:        string;      // ISO timestamp
}

export interface RosterEntry {
  uid:          string;
  username:     string;
  full_name:    string;
  role:         UserRole;
  clock_in_at:  string;
  clock_out_at: string | null;
  status:       'active' | 'clocked_out';
}

export interface AuthUser {
  uid:       string;
  role:      UserRole;
  full_name: string;
  username:  string;
}

export interface UserProfile {
  uid:       string;
  username:  string;
  full_name: string;
  role:      UserRole;
  is_active: boolean;
}

export interface Modifier {
  id:            string;
  name:          string;
  price_delta:   number;
  sort_order:    number;
  is_active:     boolean;
  recipe_lines?: RecipeLine[];  // stock deducted when this modifier is selected
}

export interface ModifierGroup {
  id:          string;
  name:        string;
  is_required: boolean;
  max_select:  number;
  sort_order?: number;
  is_active?:  boolean;
  modifiers:   Modifier[];
}

export interface RecipeLine {
  stock_item_id:     string;
  quantity_required: number;
}

export interface Product {
  id:              string;
  name:            string;
  price:           number;
  cost:            number;
  category_id:     string;
  category_ids?:   string[];
  category_name:   string;
  tracking_mode:   TrackingMode;
  stock_item_id:   string | null;
  recipe_lines:    RecipeLine[];
  image:           string | null;
  needs_kitchen:   boolean;
  is_active:       boolean;
  stock_status:    StockStatus;
  modifier_groups: ModifierGroup[];
}

export interface Category {
  id:         string;
  name:       string;
  sort_order: number;
  is_active:  boolean;
}

export interface SelectedModifier {
  modifier_id:   string;
  modifier_name: string;
  group_name:    string;
  price_delta:   number;
  recipe_lines?: RecipeLine[];  // snapshot carried for stock deduction at checkout
}

export interface CartItem {
  cart_key:        string;
  product_id:      string;
  name:            string;
  base_price:      number;
  unit_cost:       number;
  modifier_total:  number;
  unit_price:      number;
  modifiers:       SelectedModifier[];
  quantity:        number;
  notes:           string;
  tracking_mode?:  TrackingMode;
  stock_item_id?:  string | null;
  recipe_lines?:   RecipeLine[];
  needs_kitchen?:  boolean;
}

export interface CashSession {
  id:             string;
  user_id:        string;
  cashier_name:   string;
  start_time:     string;
  end_time:       string | null;
  starting_cash:  number;
  expected_cash:  number | null;
  actual_cash:    number | null;
  difference:     number | null;
  status:         'open' | 'closed';
  cash_collected?:      number;
  // Opener / closer audit fields
  opened_by_uid?:       string;
  opened_by_name?:      string;
  closed_by_uid?:       string;
  closed_by_name?:      string;
  // Cashier roster fields (present on sessions created after roster feature)
  active_cashier_uid?:  string;
  active_cashier_name?: string;
  roster?:              RosterEntry[];
  cashier_log?:         CashierEvent[];
}

export interface Order {
  id:               string;
  order_number:     string;
  user_id:          string;
  cashier_name?:    string;
  subtotal:         number;
  discount_amount:  number;
  total_amount:     number;
  profit_amount?:   number;
  payment_method:   PaymentMethod;
  payment_status:   'unpaid' | 'paid';
  status:           OrderStatus;
  order_type:       OrderType;
  table_number:     string | null;
  session_id:       string;
  created_at:       string;
  completed_at:     string | null;
  items:            OrderItem[];
}

export interface OrderItem {
  product_id:     string;
  product_name:   string;
  unit_price:     number;
  unit_cost:      number;
  quantity:       number;
  subtotal:       number;
  notes:          string | null;
  modifiers:      SelectedModifier[];
  // Stock snapshot — stored at order time so voidOrder can reverse deductions
  tracking_mode?: TrackingMode;
  stock_item_id?: string | null;
  recipe_lines?:  RecipeLine[];
}

export interface StockItem {
  id:               string;
  name:             string;
  unit:             string;
  quantity_on_hand: number;
  reorder_level:    number;
  cost_per_unit:    number;
  is_active:        boolean;
  stock_status:     StockStatus;
}

export type PaperWidth = '58mm' | '80mm';

export interface Settings {
  business_name?:           string;
  business_address?:        string;
  business_phone?:          string;
  receipt_footer?:          string;
  receipt_printer_type?:    'wifi' | 'bluetooth';
  receipt_printer_ip?:      string;
  receipt_printer_port?:    number;
  receipt_printer_bt?:      string;
  receipt_paper_width?:     PaperWidth;
  receipt_printer_model?:   string;
  kitchen_printer_type?:    'wifi' | 'bluetooth';
  kitchen_printer_ip?:      string;
  kitchen_printer_port?:    number;
  kitchen_printer_bt?:      string;
  kitchen_paper_width?:     PaperWidth;
  kitchen_printer_model?:   string;
}

export interface PendingOrder {
  local_id:    string;
  payload:     CheckoutPayload;
  created_at:  string;
  retry_count: number;
}

export interface FailedOrder {
  local_id:   string;
  payload:    CheckoutPayload;
  created_at: string;
  failed_at:  string;
}

export interface CheckoutPayload {
  session_id?:         string;
  payment_method:      PaymentMethod;
  order_type:          OrderType;
  table_number?:       string;
  cash_received?:      number;
  reference_number?:   string;
  discount_amount?:    number;
  discount_auth_nonce?: string;
  cart_snapshot:       CartItem[];
  order_number?:       string; // pre-assigned offline; reused on sync so receipt matches Firestore
}
