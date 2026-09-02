import { piiAttrsSpan } from '../../../instrument';
import type { ShopLiteStore } from '../store';

const mask = (card: string) => `•••• •••• •••• ${card.slice(-4)}`;

export default function AccountPage({ store }: { store: ShopLiteStore }) {
  const { profile } = store;
  return (
    <section className="card account">
      <h1>Account</h1>
      <dl>
        <dt>Name</dt><dd><span {...piiAttrsSpan('PERSON_NAME', 3, profile.ids.name!)}>{profile.name}</span></dd>
        <dt>Email</dt><dd><span {...piiAttrsSpan('EMAIL', 2, profile.ids.email!)}>{profile.email}</span></dd>
        <dt>Phone</dt><dd><span {...piiAttrsSpan('PHONE', 2, profile.ids.phone!)}>{profile.phone}</span></dd>
        <dt>Address</dt>
        <dd>
          <span {...piiAttrsSpan('STREET_ADDRESS', 3, profile.ids.street!)}>{profile.street}</span>,{' '}
          <span {...piiAttrsSpan('STREET_ADDRESS', 3, profile.ids.city!)}>{profile.city}</span>{' '}
          <span {...piiAttrsSpan('POSTAL_CODE', 3, profile.ids.pin!)}>{profile.pin}</span>
        </dd>
        <dt>KYC (Aadhaar)</dt><dd><span {...piiAttrsSpan('AADHAAR', 2, profile.ids.aadhaar!)}>{profile.aadhaar}</span></dd>
        <dt>Saved card</dt><dd>{mask(profile.card)}</dd>
      </dl>
      <h2>Change password</h2>
      <form onSubmit={e => e.preventDefault()}>
        <div className="field">
          <label htmlFor="current-password">Current password</label>
          <input id="current-password" type="password" autoComplete="current-password" placeholder="Current password" />
        </div>
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input id="new-password" type="password" autoComplete="new-password" placeholder="New password" />
        </div>
        <button type="submit">Update password</button>
      </form>
    </section>
  );
}
