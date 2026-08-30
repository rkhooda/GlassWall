import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

interface Order {
  id: string;
  items: Array<{id: number; name: string; price: number; quantity: number}>;
  total: number;
  status: string;
  timestamp: number;
  shippingAddress: string;
}

const OrderTrackingPage = ({ orders: initialOrders = [] }: { orders?: Order[] }) => {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    if (orderId) {
      const foundOrder = initialOrders.find(o => o.id === orderId);
      setOrder(foundOrder || null);
    }
  }, [orderId, initialOrders]);

  if (!order) {
    return (
      <div className="order-tracking-page">
        <p>Order not found.</p>
        <Link to="/orders">Back to Orders</Link>
      </div>
    );
  }

  const estimatedDelivery = new Date(order.timestamp + 5 * 24 * 60 * 60 * 1000).toLocaleDateString();
  const currentLocation = ['Warehouse', 'In Transit', 'Out for Delivery', 'Delivered'][0];

  return (
    <div className="order-tracking-page">
      <h1>Order Tracking</h1>
      <div className="order-details">
        <div className="order-info">
          <span>Order ID: {order.id}</span>
          <span>Date: {new Date(order.timestamp).toLocaleDateString()}</span>
          <span>Total: ₹{order.total}</span>
          <span>Status: {order.status}</span>
        </div>
        <div className="tracking-info">
          <h2>Tracking Information</h2>
          <p>Estimated Delivery: {estimatedDelivery}</p>
          <p>Current Location: {currentLocation}</p>
          <p>More details will be available as the order progresses.</p>
        </div>
        <div className="order-items mt-4">
          <h3>Items:</h3>
          <ul>
            {order.items.map(item => (
              <li key={item.id}>{item.name} × {item.quantity} — ₹{item.price * item.quantity}</li>
            ))}
          </ul>
        </div>
      </div>
      <Link to="/orders">Back to Orders</Link>
    </div>
  );
};

export default OrderTrackingPage;