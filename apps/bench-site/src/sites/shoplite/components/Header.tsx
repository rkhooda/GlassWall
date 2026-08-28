import { Link } from 'react-router-dom';

const Header = ({ cartCount }: { cartCount: number }) => {
  return (
    <header className="header">
      <div className="header-content">
        <Link to="/" className="logo">
          ShopLite
        </Link>
        <nav className="header-nav">
          <Link to="/cart" className="cart-link">
            Cart ({cartCount})
          </Link>
        </nav>
      </div>
    </header>
  );
};

export default Header;