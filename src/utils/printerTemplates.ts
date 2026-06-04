import { EscPos, PaperWidth } from './escpos';
import { Order, Settings } from '../types';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// ─── Test page ────────────────────────────────────────────────────────────────

export function buildTestPage(
  settings: Settings,
  printer:  'receipt' | 'kitchen',
): Uint8Array {
  const width  = printer === 'receipt'
    ? (settings.receipt_paper_width ?? '80mm')
    : (settings.kitchen_paper_width ?? '80mm') as PaperWidth;
  const doc    = new EscPos(width);
  const name   = settings.business_name ?? 'SmartBrew POS';
  const label  = printer === 'receipt' ? 'Receipt Printer' : 'Kitchen Printer';

  doc.init();
  if (printer === 'kitchen') doc.buzzer();   // verify the kitchen buzzer here

  return doc
    .align('center')
    .bold(true).size(2, 1).line(name).size(1, 1).bold(false)
    .feed()
    .bold(true).line('*** PRINT TEST ***').bold(false)
    .divider()
    .align('left')
    .line('Printer connected successfully.')
    .line(`Type:    ${label}`)
    .line(`Paper:   ${width} (${doc.cols} columns)`)
    .divider()
    .align('center')
    .line(fmtDate(new Date().toISOString()))
    .feed(3)
    .cut()
    .bytes();
}

// ─── Customer receipt ─────────────────────────────────────────────────────────

export function buildReceipt(
  order:      Order,
  change:     number,
  settings:   Settings,
  openDrawer: boolean = false,
): Uint8Array {
  const width   = (settings.receipt_paper_width ?? '80mm') as PaperWidth;
  const doc     = new EscPos(width);
  const bizName = settings.business_name    ?? 'SmartBrew POS';
  const address = settings.business_address ?? '';
  const phone   = settings.business_phone   ?? '';
  const footer  = settings.receipt_footer   ?? 'Thank you for visiting!';

  // Header — kick the drawer first so it opens as the receipt starts printing.
  doc.init();
  if (openDrawer) doc.kick();
  doc.align('center')
    .bold(true).size(2, 1).line(bizName).size(1, 1).bold(false);
  if (address) doc.line(address);
  if (phone)   doc.line(phone);

  doc.feed()
    .line(`Order #${order.order_number}`)
    .line(fmtDate(order.created_at));

  const typeLabel: Record<string, string> = {
    dine_in: 'Dine In', takeaway: 'Takeaway', delivery: 'Delivery',
  };
  doc.line(typeLabel[order.order_type] ?? order.order_type);
  if (order.table_number) doc.line(`Table: ${order.table_number}`);

  doc.divider().align('left');

  // Items
  for (const item of (order.items ?? [])) {
    doc.bold(true).line(item.product_name).bold(false);
    if (item.modifiers?.length) {
      doc.line('  ' + item.modifiers.map((m) => m.modifier_name).join(', '));
    }
    if (item.notes) doc.line(`  "${item.notes}"`);
    doc.row(`  x${item.quantity}`, `P${item.subtotal.toFixed(2)}`);
  }

  // Totals
  doc.divider();
  if ((order.discount_amount ?? 0) > 0) {
    doc.row('Subtotal:', `P${order.subtotal.toFixed(2)}`);
    doc.row('Discount:', `-P${order.discount_amount.toFixed(2)}`);
  }
  doc.bold(true).row('TOTAL:', `P${order.total_amount.toFixed(2)}`).bold(false);

  // Payment
  const payLabel: Record<string, string> = {
    cash: 'Cash', card: 'Card', qr: 'QR', gift_card: 'Gift Card', pay_later: 'Pay Later',
  };
  doc.row('Payment:', payLabel[order.payment_method] ?? order.payment_method);
  if (order.payment_method === 'cash' && change > 0) {
    doc.row('Change:', `P${change.toFixed(2)}`);
  }
  if (order.cashier_name) doc.row('Cashier:', order.cashier_name);

  doc.divider().align('center').line(footer).feed(3).cut();
  return doc.bytes();
}

// ─── Kitchen ticket ───────────────────────────────────────────────────────────

export function buildKitchenTicket(
  order:    Order,
  settings: Settings,
): Uint8Array {
  // Only items flagged "Needs Kitchen Ticket" go to the kitchen printer.
  const kitchenItems = (order.items ?? []).filter((i) => i.needs_kitchen);
  if (kitchenItems.length === 0) return new Uint8Array(0);

  const width = (settings.kitchen_paper_width ?? '80mm') as PaperWidth;
  const doc   = new EscPos(width);

  const typeLabel: Record<string, string> = {
    dine_in: 'DINE IN', takeaway: 'TAKEAWAY', delivery: 'DELIVERY',
  };

  // Header — buzz first so staff hear the alert as the ticket starts printing.
  doc.init().buzzer().align('center')
    .bold(true).size(2, 2).line('KITCHEN').size(1, 1).bold(false);

  if (order.order_type === 'dine_in' && order.table_number) {
    doc.bold(true).size(2, 1).line(`TABLE ${order.table_number}`).size(1, 1).bold(false);
  } else {
    doc.line(typeLabel[order.order_type] ?? order.order_type);
  }

  doc.bold(true).line(`#${order.order_number}`).bold(false)
    .divider()
    .align('left');

  // Items (large text for readability at distance)
  for (const item of kitchenItems) {
    doc.bold(true).size(1, 2)
      .line(`${item.quantity}x ${item.product_name}`)
      .size(1, 1).bold(false);
    if (item.modifiers?.length) {
      doc.line('  > ' + item.modifiers.map((m) => m.modifier_name).join(', '));
    }
    if (item.notes) doc.line(`  ! ${item.notes}`);
  }

  doc.divider()
    .align('center')
    .line(new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true }))
    .feed(3).cut();

  return doc.bytes();
}
