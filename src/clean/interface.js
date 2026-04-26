export class Cleaner {
  get name () { return 'passthrough' }
  async clean (item) { return item.description || '' }
}
