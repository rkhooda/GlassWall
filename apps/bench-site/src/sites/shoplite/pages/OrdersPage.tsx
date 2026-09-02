import { Link } from 'react-router-dom';
import type { ShopLiteStore } from '../store';

export default function OrdersPage({ store }: { store: ShopLiteStore }) {
  return (
    <section>
      <h1>Your orders</h1>
      <table className="table" aria-label="Orders">
        <thead>
          <tr><th>Order</th><th>Items</th><th>Placed</th><th>Total</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {store.orders.map(o => (
            <tr key={o.id} data-order-id={o.id} data-status={o.status}>
              <td><code>{o.id}</code></td>
              <td>{o.items.map(i => `${i.name} × ${i.quantity}`).join(', ')}</td>
              <td>{new Date(o.placedAt).toLocaleDateString('en-IN')}</td>
              <td>₹{o.total.toLocaleString('en-IN')}</td>
              <td><span className={`status ${o.status.toLowerCase()}`}>{o.status}</span></td>
              <td><Link to={`/shoplite/tracking/${o.id}`}>Track</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
