import { Link, useParams } from 'react-router-dom';
import type { ShopLiteStore } from '../store';

const STEPS = ['Processing', 'Shipped', 'Delivered'] as const;

export default function TrackingPage({ store }: { store: ShopLiteStore }) {
  const { orderId } = useParams<{ orderId: string }>();
  const order = store.orders.find(o => o.id === orderId);
  if (!order) {
    return (
      <section>
        <p>Order not found.</p>
        <Link to="/shoplite/orders">Back to orders</Link>
      </section>
    );
  }
  const reached = STEPS.indexOf(order.status);
  return (
    <section className="card">
      <h1>Tracking {order.id}</h1>
      <p>Tracking number: <code>{order.tracking}</code></p>
      <ol className="timeline">
        {STEPS.map((s, i) => (
          <li key={s} className={i <= reached ? 'done' : ''}>{s}</li>
        ))}
      </ol>
      <p>Current status: <strong id="tracking-status">{order.status}</strong></p>
      <Link to="/shoplite/orders">Back to orders</Link>
    </section>
  );
}
