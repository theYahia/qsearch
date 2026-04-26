import { Cleaner } from './interface.js'

export class PassthroughCleaner extends Cleaner {
  get name () { return 'passthrough' }
  async clean (item) { return item.description || '' }
}
