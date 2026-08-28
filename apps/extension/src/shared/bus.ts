// Typed message bus for communication between extension components
// Lane A (us) can send/receive on: "system:*", "extension:*"
// Lane B (teammate) can register handlers under: "perception:*" and "privacy:*"

export type MessageType =
  | { type: "perception:init"; payload: { preferredEP: 'webgpu' | 'wasm' | 'auto' } }
  | { type: "perception:load"; payload: { modelId: string } }
  | { type: "perception:run"; payload: { modelId: string; inputs: Record<string, unknown> } }
  | { type: "perception:bench"; payload: { modelId: string; n: number } }
  | { type: "privacy:sanitize"; payload: {
      raw: any; // RawObservation
      frame: any | null; // CapturedFrame | null
      task: string;
      step: number;
      session: { session_id: string; policy_profile: 'STRICT' | 'BALANCED' | 'PERMISSIVE' };
    } }
  | { type: "system:ping"; payload: { timestamp: number } }
  | { type: "system:pong"; payload: { timestamp: number } }
  | { type: "extension:ready"; payload: {} };

export type Message = MessageType;

interface MessageBusOptions {
  namespace: string;
}

class MessageBus {
  private namespace: string;
  private listeners: Map<string, Set<(message: Message) => void>> = new Map();
  private messageQueue: Message[] = [];
  private isProcessing = false;

  constructor(options: MessageBusOptions) {
    this.namespace = options.namespace;
  }

  // Publish a message to the bus
  publish(message: Message): void {
    // Add namespace prefix to message type for isolation
    const namespacedMessage = this.addNamespace(message);
    this.messageQueue.push(namespacedMessage);
    this.processQueue();
  }

  // Subscribe to messages of a specific type
  subscribe(type: Message['type'], callback: (message: Message) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    const listeners = this.listeners.get(type)!;
    listeners.add(callback);

    // Return unsubscribe function
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  // Add namespace prefix to message type for isolation
  private addNamespace(message: Message): Message {
    // For simplicity in this skeleton, we'll just return the message
    // In a full implementation, this would add namespace prefixes
    // and validate that the message is allowed for this bus instance
    return message;
  }

  // Process the message queue
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.messageQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    try {
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift()!;
        await this.deliverMessage(message);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  // Deliver a message to all subscribers
  private async deliverMessage(message: Message): Promise<void> {
    const listeners = this.listeners.get(message.type);
    if (listeners) {
      // Create a copy to avoid issues if listeners unsubscribe during execution
      const listenersCopy = Array.from(listeners);
      for (const callback of listenersCopy) {
        try {
          callback(message);
        } catch (error) {
          console.error('Error in message bus listener:', error);
        }
      }
    }
  }
}

// Create a bus instance for shared use
// In a real implementation, we might have different buses for different contexts
export const bus = new MessageBus({ namespace: 'shared' });

// Helper function to create a namespaced message type
export function createMessageType<N extends string, T extends string>(namespace: N, type: T): `${N}:${T}` {
  return `${namespace}:${type}` as `${N}:${T}`;
}