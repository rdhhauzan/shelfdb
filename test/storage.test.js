import { describe, expect, it } from 'vitest';
import { ShelfDB } from '../src/storage';
describe('ShelfDB storage', () => {
    it('inserts and queries documents', () => {
        const db = new ShelfDB({ dataFile: 'data/test.json', journalFile: 'data/test.ndjson', backupsDir: 'backups' });
        db.importJSON({ collections: {} });
        const a = db.insert('books', { title: 'Dune' });
        const b = db.insert('books', { title: 'Foundation' });
        expect(a._id).not.toEqual(b._id);
        const res = db.query('books', { q: 'Dune' });
        expect(res.total).toBe(1);
        expect(res.items[0].title).toBe('Dune');
    });
});
//# sourceMappingURL=storage.test.js.map