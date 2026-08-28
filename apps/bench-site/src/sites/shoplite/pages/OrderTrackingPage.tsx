import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

// Mock order data generation (same as in OrdersPage)
const generateMockOrderById = (id: string) => {
  // Extract the numeric part from the order ID (e.g., "order_1000" -> 1000)
  const match = id.match(/order_(\d+)/);
  if (!match) {
    return null;
  }
  const num = parseInt(match[1], 10);
  const index = num - 1000; // because we started at 1000
  const date = new Date(Date.now() - index * 24 * 60 * 60 * 1000).toLocaleDateString();
  const total = Math.floor(Math.random() * 10000) + 500; // between 500 and 10500
  const status = ['Processing', 'Shipped', 'Delivered', 'Cancelled'][Math.floor(Math.random() * 4)];
  // Tracking details
  const estimatedDelivery = new Date(Date.now() + (Math.floor(Math.random() * 5) + 1) * 24 * 60 * 60 * 1000).toLocaleDateString();
  const currentLocation = ['Warehouse', 'In Transit', 'Out for Delivery', 'Delivered'][Math.floor(Math.random() * 4)];
  return { id, date, total, status, estimatedDelivery, currentLocation };
};

const OrderTrackingPage = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<any>(null);

  useEffect(() => {
    if (orderId) {
      const mockOrder = generateMockOrderById(orderId);
      setOrder(mockOrder);
    }
  }, [orderId]);

  if (!order) {
    return (
      <div className="order-tracking-page">
        <p>Loading order details...</p>
        <Link to="/orders">Back to Orders</Link>
      </div>
    );
  }

  return (
    <div className="order-tracking-page">
      <h1>Order Tracking</h1>
      <div className="order-details">
        <div className="order-info">
          <span>Order ID: {order.id}</span>
          <span>Date: {order.date}</span>
          <span>Total: ₹{order.total}</span>
          <span>Status: {order.status}</span>
        </div>
        <div className="tracking-info">
          <h2>Tracking Information</h2>
          <p>Estimated Delivery: {order.estimatedDelivery}</p>
          <p>Current Location: {order.currentLocation}</p>
          <p>More details will be available as the order progresses.</p>
        </div>
      </div>
      <Link to="/orders">Back to Orders</Link>
    </div>
  );
};

export default OrderTrackingPage;