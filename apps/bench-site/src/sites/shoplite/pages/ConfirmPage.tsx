import { Link, useParams } from 'react-router-dom';
import type { ShopLiteStore } from '../store';

export default function ConfirmPage({ store }: { store: ShopLiteStore }) {
  const { orderId } = useParams<{ orderId: string }>();
  const order = store.orders.find(o => o.id === orderId);

  return (
    <section className="card" id="order-confirmation">
      <h1>Order placed</h1>
      {order ? (
        <>
          <p>Thank you. Your order <strong>{order.id}</strong> is confirmed.</p>
          <p>Tracking number: <code>{order.tracking}</code></p>
          <ul>
            {order.items.map(i => (
              <li key={i.id}>{i.name} × {i.quantity}</li>
            ))}
          </ul>
          <p>Total: ₹{order.total.toLocaleString('en-IN')}</p>
        </>
      ) : (
        <p>Order not found.</p>
      )}
      <Link to="/shoplite/orders">View orders</Link>
    </section>
  );
}
