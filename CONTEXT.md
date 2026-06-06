# SmartBrew — Domain Glossary

## Surfaces

**SmartBrewApp** — The React Native mobile app used by cashiers and admins/managers on Android (and optionally iOS). Routes to a cashier or admin navigation stack based on the logged-in user's role.

**SmartBrewAdminWeb** — The React + Vite web app used by admins and managers from any browser (desktop or mobile). Provides the same management capabilities as the admin screens in SmartBrewApp. Deployed to Firebase Hosting as a second hosting target.

---

## Roles

**Admin** — A user with full system access: menu management, user management, settings, stock, reports, and session oversight.

**Manager** — A user with a subset of admin capabilities: category editing, stock management, and reports. Cannot manage users, modifiers, or system settings.

**Cashier** — A user who operates the point-of-sale. Can open/close Sessions, take Orders, and process payments. Cannot access management screens.

---

## Core Domain

**Session** (also: Cash Session) — A register shift opened by a cashier with a starting cash amount. All Orders taken during a shift belong to a Session. A Session is closed with a blind cash count, reconciled against expected cash, and then sealed.

**Roster** — The record of cashiers who clocked in and out during a Session, including shift switches.

**Order** — A completed sales transaction belonging to a Session. Contains one or more OrderItems, a payment method, order type, and financial totals (subtotal, discount, total, profit).

**OrderItem** — A single line in an Order: a Product at a quantity, with any selected Modifiers and a snapshot of cost/price at the time of sale.

**Cart** — The in-progress collection of items being assembled before an Order is placed. A CartItem is the working representation of a Product in the Cart.

**CheckoutPayload** — The data submitted to create an Order from a Cart, including session, payment method, order type, discount authorization, and cart snapshot.

**OrderType** — How an order is fulfilled: `dine_in`, `takeaway`, or `delivery`.

**PaymentMethod** — How an order is paid: `cash`, `card`, `qr`, `gift_card`, or `pay_later`.

**Pay Later** — An order recorded without immediate payment, associated with a customer name or tab label. Settled before session close.

---

## Menu

**Product** — A sellable menu item with a name, price, cost, category, image, and optional stock tracking. A Product may have one or more ModifierGroups.

**Category** — A grouping for Products used to organize the menu display (e.g., "Coffee", "Food").

**ModifierGroup** — A named set of options that can be attached to a Product (e.g., "Size", "Add-ons"). May be required or optional, with a maximum selection count.

**Modifier** — A single option within a ModifierGroup (e.g., "Large", "Extra Shot"). Has a price delta (positive, negative, or zero) and optionally deducts stock via RecipeLines.

---

## Stock

**StockItem** — A physical inventory unit tracked by quantity (e.g., "Espresso Beans — kg"). Has a reorder level and cost per unit.

**TrackingMode** — How a Product's stock is tracked: `none` (no tracking), `direct` (deducts a StockItem directly), or `recipe` (deducts multiple StockItems via RecipeLines).

**RecipeLine** — A mapping from a Product or Modifier to a StockItem quantity consumed when that item is sold.

**StockStatus** — The availability state of a StockItem or Product: `ok`, `low`, or `out`.

---

## Auth & Identity

**AuthUser** — The in-session representation of a logged-in user: uid, role, full name, and username.

**UserProfile** — The persisted user record in Firestore: same fields as AuthUser plus `is_active`.

**PIN Login** — The authentication method used across both SmartBrewApp and SmartBrewAdminWeb: username + numeric PIN, mapped internally to `{username}@smartbrew.app` for Firebase Auth.
