// First-run screen: what GLASSWALL is, before the panel asks for a task.
export default function Welcome({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="welcome">
      <button type="button" className="welcome-close" aria-label="Skip the introduction" onClick={onDismiss}>
        <img src="/icons/close.svg" alt="" width={24} height={24} />
      </button>
      <span className="welcome-chip">100% Stored Locally</span>
      <img className="welcome-mark" src="/icons/logo.svg" alt="" width={120} height={120} />
      <h1>Your browser agent, with privacy built in.</h1>
      <p>Give GLASSWALL a task. It browses for you while your sensitive data stays protected locally.</p>
      <button type="button" className="primary block" onClick={onDismiss}>Get Started</button>
    </div>
  );
}
