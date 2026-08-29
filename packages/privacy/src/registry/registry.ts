import { normalize } from './normalize';
import { generateEncodings } from './encodings';

export interface SecretEntry {
  value: string;
  normalized: string;
  type: string;
  tier: number;
  encodings: string[];
  addedAt: number;
}

export class SecretRegistry {
  private entries = new Map<string, SecretEntry>();
  private automaton: AhoCorasick | null = null;
  private dirty = true;

  add(value: string, type: string, tier: number): void {
    const normalized = normalize(value);
    if (this.entries.has(normalized)) {
      return;
    }

    const encodings = generateEncodings(normalized);
    const entry: SecretEntry = {
      value,
      normalized,
      type,
      tier,
      encodings,
      addedAt: Date.now(),
    };

    this.entries.set(normalized, entry);
    this.dirty = true;
  }

  has(value: string): boolean {
    const normalized = normalize(value);
    return this.entries.has(normalized);
  }

  get(value: string): SecretEntry | undefined {
    const normalized = normalize(value);
    return this.entries.get(normalized);
  }

  getAll(): SecretEntry[] {
    return Array.from(this.entries.values());
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.automaton = null;
    this.dirty = true;
  }

  getAutomaton(): AhoCorasick {
    if (this.dirty || !this.automaton) {
      this.rebuildAutomaton();
    }
    return this.automaton!;
  }

  private rebuildAutomaton(): void {
    const patterns: string[] = [];
    for (const entry of this.entries.values()) {
      patterns.push(entry.normalized);
      patterns.push(...entry.encodings);
    }
    this.automaton = new AhoCorasick(patterns);
    this.dirty = false;
  }
}

export interface AhoCorasickMatch {
  pattern: string;
  start: number;
  end: number;
}

export class AhoCorasick {
  private trie: TrieNode;
  private output: Map<TrieNode, string[]> = new Map();

  constructor(patterns: string[]) {
    this.trie = { children: {}, fail: null, output: [] };
    this.buildTrie(patterns);
    this.buildFailureLinks();
  }

  private buildTrie(patterns: string[]): void {
    for (const pattern of patterns) {
      if (!pattern || pattern.length < 6) continue;
      let node = this.trie;
      for (const ch of pattern) {
        if (!node.children[ch]) {
          node.children[ch] = { children: {}, fail: null, output: [] };
        }
        node = node.children[ch]!;
      }
      if (!this.output.has(node)) {
        this.output.set(node, []);
      }
      this.output.get(node)!.push(pattern);
    }
  }

  private buildFailureLinks(): void {
    const queue: TrieNode[] = [];

    for (const ch of Object.keys(this.trie.children)) {
      const child = this.trie.children[ch]!;
      child.fail = this.trie;
      queue.push(child);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;

      for (const ch of Object.keys(current.children)) {
        const child = current.children[ch]!;
        let fail: TrieNode | null = current.fail;

        while (fail && !fail.children[ch]) {
          fail = fail.fail;
        }

        child.fail = fail ? fail.children[ch]! || this.trie : this.trie;

        const failOutput = this.output.get(child.fail!);
        if (failOutput && failOutput.length > 0) {
          if (!this.output.has(child)) {
            this.output.set(child, []);
          }
          this.output.get(child)!.push(...failOutput);
        }

        queue.push(child);
      }
    }
  }

  search(text: string): AhoCorasickMatch[] {
    const matches: AhoCorasickMatch[] = [];
    let node = this.trie;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;

      while (node !== this.trie && !node.children[ch]) {
        node = node.fail!;
      }

      if (node.children[ch]) {
        node = node.children[ch]!;
      }

      const outputs = this.output.get(node);
      if (outputs) {
        for (const pattern of outputs) {
          matches.push({
            pattern,
            start: i - pattern.length + 1,
            end: i + 1,
          });
        }
      }
    }

    return matches;
  }
}

interface TrieNode {
  children: Record<string, TrieNode>;
  fail: TrieNode | null;
  output: string[];
}