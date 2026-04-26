export class SearchBackend {
  get name () { return 'unnamed' }
  async search (query, opts = {}) { throw new Error('not implemented') }
}
