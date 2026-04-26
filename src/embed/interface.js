export class Embedder {
  get name () { return 'unnamed' }
  get dim () { return 0 }
  async embed (text) { throw new Error('not implemented') }
  async embedBatch (texts) { return Promise.all(texts.map(t => this.embed(t))) }
}
