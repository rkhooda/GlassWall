import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

// VirtualizedList component
const VirtualizedList = ({
  itemCount,
  itemHeight,
  renderItem,
}: {
  itemCount: number;
  itemHeight: number;
  renderItem: (index: number) => JSX.Element;
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      if (containerRef.current) {
        setScrollTop(containerRef.current.scrollTop);
      }
    };
    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
    }
    return () => {
      if (container) {
        container.removeEventListener('scroll', handleScroll);
      }
    };
  }, []);

  // Calculate visible range
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - 1); // render one extra before
  const endIndex = Math.min(
    itemCount - 1,
    Math.ceil((scrollTop + (containerRef.current?.clientHeight || 0)) / itemHeight) + 1
  );

  const height = itemCount * itemHeight;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        overflowY: 'auto',
        height: '400px', // fixed height for the list
        border: '1px solid #ddd',
      }}
    >
      <div
        style={{
          position: 'relative',
          height: `${height}px`,
        }}
      >
        {Array.from({ length: endIndex - startIndex + 1 })
          .map((_, i) => startIndex + i)
          .map((index) => (
            <div
              key={index}
              style={{
                position: 'absolute',
                top: `${index * itemHeight}px`,
                left: 0,
                right: 0,
                height: `${itemHeight}px`,
              }}
            >
              {renderItem(index)}
            </div>
          ))}
      </div>
    </div>
  );
};

// Mock order data generation
const generateMockOrders = (count: number) => {
  const orders = [];
  for (let i = 0; i < count; i++) {
    const id = `order_${1000 + i}`;
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toLocaleDateString();
    const total = Math.floor(Math.random() * 10000) + 500; // between 500 and 10500
    const status = ['Processing', 'Shipped', 'Delivered', 'Cancelled'][Math.floor(Math.random() * 4)];
    orders.push({ id, date, total, status });
  }
  return orders;
};

const OrdersPage = ({ onViewTracking }: { onViewTracking: (orderId: string) => void }) => {
  const [orders] = useState(() => generateMockOrders(100)); // 100 orders
  const itemHeight = 60; // height of each order item in pixels

  const renderOrderItem = (index: number) => {
    const order = orders[index];
    return (
      <div className="order-item" onClick={() => onViewTracking(order.id)}>
        <div className="order-info">
          <span className="order-id">Order ID: {order.id}</span>
          <span className="order-date">Date: {order.date}</span>
          <span className="order-total">Total: ₹{order.total}</span>
          <span className="order-status">Status: {order.status}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="orders-page">
      <h1>Your Orders</h1>
      <VirtualizedList
        itemCount={orders.length}
        itemHeight={itemHeight}
        renderItem={renderOrderItem}
      />
    </div>
  );
};

export default OrdersPage;