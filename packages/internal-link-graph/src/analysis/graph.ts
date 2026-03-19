import type { LinkGraphEdge, PageScore } from '../models/types.js';

interface AdjacencyList {
  outgoing: Map<string, Set<string>>;
  incoming: Map<string, Set<string>>;
}

export class LinkGraph {
  private nodes: Set<string> = new Set();
  private edges: LinkGraphEdge[] = [];
  private adj: AdjacencyList = {
    outgoing: new Map(),
    incoming: new Map(),
  };

  addEdge(edge: LinkGraphEdge): void {
    this.nodes.add(edge.sourceUrl);
    this.nodes.add(edge.targetUrl);
    this.edges.push(edge);

    if (!this.adj.outgoing.has(edge.sourceUrl)) {
      this.adj.outgoing.set(edge.sourceUrl, new Set());
    }
    this.adj.outgoing.get(edge.sourceUrl)!.add(edge.targetUrl);

    if (!this.adj.incoming.has(edge.targetUrl)) {
      this.adj.incoming.set(edge.targetUrl, new Set());
    }
    this.adj.incoming.get(edge.targetUrl)!.add(edge.sourceUrl);
  }

  buildFromEdges(edges: LinkGraphEdge[]): void {
    for (const edge of edges) {
      this.addEdge(edge);
    }
  }

  getNodes(): string[] {
    return Array.from(this.nodes);
  }

  getEdges(): LinkGraphEdge[] {
    return this.edges;
  }

  getOutgoing(url: string): string[] {
    return Array.from(this.adj.outgoing.get(url) ?? []);
  }

  getIncoming(url: string): string[] {
    return Array.from(this.adj.incoming.get(url) ?? []);
  }

  getInboundCount(url: string): number {
    return this.adj.incoming.get(url)?.size ?? 0;
  }

  getOutboundCount(url: string): number {
    return this.adj.outgoing.get(url)?.size ?? 0;
  }

  /**
   * PageRank algorithm (power iteration).
   * damping: probability of following a link (typically 0.85)
   * iterations: number of power iterations
   */
  computePageRank(damping: number = 0.85, iterations: number = 100, tolerance: number = 1e-6): Map<string, number> {
    const n = this.nodes.size;
    if (n === 0) return new Map();

    const nodeList = Array.from(this.nodes);
    const rank = new Map<string, number>();
    const initialRank = 1 / n;

    for (const node of nodeList) {
      rank.set(node, initialRank);
    }

    for (let iter = 0; iter < iterations; iter++) {
      const newRank = new Map<string, number>();
      let diff = 0;

      // Sum of ranks of dangling nodes (nodes with no outgoing links)
      let danglingSum = 0;
      for (const node of nodeList) {
        if (this.getOutboundCount(node) === 0) {
          danglingSum += rank.get(node)!;
        }
      }

      for (const node of nodeList) {
        let incomingRankSum = 0;
        const incoming = this.getIncoming(node);

        for (const src of incoming) {
          const srcOutCount = this.getOutboundCount(src);
          incomingRankSum += rank.get(src)! / srcOutCount;
        }

        const newScore = (1 - damping) / n + damping * (incomingRankSum + danglingSum / n);
        newRank.set(node, newScore);
        diff += Math.abs(newScore - rank.get(node)!);
      }

      for (const [node, score] of newRank) {
        rank.set(node, score);
      }

      if (diff < tolerance) break;
    }

    return rank;
  }

  /**
   * HITS algorithm (Hyperlink-Induced Topic Search).
   * Returns authority and hub scores for each node.
   */
  computeHITS(iterations: number = 100, tolerance: number = 1e-6): { authority: Map<string, number>; hub: Map<string, number> } {
    const nodeList = Array.from(this.nodes);
    const n = nodeList.length;
    if (n === 0) return { authority: new Map(), hub: new Map() };

    const authority = new Map<string, number>();
    const hub = new Map<string, number>();

    for (const node of nodeList) {
      authority.set(node, 1);
      hub.set(node, 1);
    }

    for (let iter = 0; iter < iterations; iter++) {
      let diff = 0;

      // Update authority scores: auth(p) = sum of hub(q) for all q linking to p
      const newAuth = new Map<string, number>();
      for (const node of nodeList) {
        let score = 0;
        for (const src of this.getIncoming(node)) {
          score += hub.get(src)!;
        }
        newAuth.set(node, score);
      }

      // Normalize authority
      let authNorm = 0;
      for (const score of newAuth.values()) authNorm += score * score;
      authNorm = Math.sqrt(authNorm) || 1;
      for (const [node, score] of newAuth) {
        newAuth.set(node, score / authNorm);
      }

      // Update hub scores: hub(p) = sum of auth(q) for all q that p links to
      const newHub = new Map<string, number>();
      for (const node of nodeList) {
        let score = 0;
        for (const target of this.getOutgoing(node)) {
          score += newAuth.get(target)!;
        }
        newHub.set(node, score);
      }

      // Normalize hub
      let hubNorm = 0;
      for (const score of newHub.values()) hubNorm += score * score;
      hubNorm = Math.sqrt(hubNorm) || 1;
      for (const [node, score] of newHub) {
        newHub.set(node, score / hubNorm);
      }

      // Check convergence
      for (const node of nodeList) {
        diff += Math.abs(newAuth.get(node)! - authority.get(node)!);
        diff += Math.abs(newHub.get(node)! - hub.get(node)!);
      }

      for (const [node, score] of newAuth) authority.set(node, score);
      for (const [node, score] of newHub) hub.set(node, score);

      if (diff < tolerance) break;
    }

    return { authority, hub };
  }

  /**
   * Compute full PageScore for each node combining PageRank and HITS.
   */
  computeAllScores(): PageScore[] {
    const pagerank = this.computePageRank();
    const { authority, hub } = this.computeHITS();

    return Array.from(this.nodes).map((url) => ({
      url,
      pagerank: pagerank.get(url) ?? 0,
      authorityScore: authority.get(url) ?? 0,
      hubScore: hub.get(url) ?? 0,
      inboundLinks: this.getInboundCount(url),
      outboundLinks: this.getOutboundCount(url),
    }));
  }

  /**
   * Find orphan pages — pages with zero or very few inbound links.
   */
  findOrphanPages(threshold: number = 0): string[] {
    return Array.from(this.nodes).filter(
      (url) => this.getInboundCount(url) <= threshold
    );
  }

  /**
   * Find pages that only link to themselves (dead-end hubs).
   */
  findDeadEnds(): string[] {
    return Array.from(this.nodes).filter(
      (url) => this.getOutboundCount(url) === 0
    );
  }
}
