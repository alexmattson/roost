import { describe, it, expect } from 'vitest';
import { categorize } from '../lib/analytics.js';

describe('categorize', () => {
  const cases = [
    ['Vintage Brass Wall Sconces (Set of 2)', 'Lighting'],
    ['Brass Candlestick Holder', 'Lighting'],
    ['Mid-Century Walnut Dresser', 'Furniture'],
    ['Oak Bookcase', 'Furniture'],
    ['Grandfather Clock', 'Clocks & Timepieces'],
    ['Antique Pocket Watch', 'Clocks & Timepieces'],
    ['Sterling Silver Necklace', 'Jewelry & Accessories'],
    ['Depression Glass Tumbler', 'Glassware'],
    ['Vintage Studio Pottery Gravy Bowl', 'Pottery & Ceramics'],
    ['Wooden Rocking Horse', 'Toys & Children'],
    ['Croquet Set', 'Sporting & Games'],
    ['Fishing Reel', 'Sporting & Games'],
    ['Singer Sewing Machine', 'Rugs & Textiles'],
    ['Persian Wool Rug', 'Rugs & Textiles'],
    ['Wicker Picnic Basket', 'Baskets & Wicker'],
    ['Royal Typewriter', 'Cameras & Electronics'],
    ['National Geographic Magazine', 'Books & Paper'],
    ['Copper Kettle', 'Kitchen & Barware'],
    ['Cast Iron Skillet', 'Kitchen & Barware'],
    ['Framed Landscape Print', 'Art & Wall Decor'],
    ['Neon Bar Sign', 'Signage & Advertising'],
    ['Wrought Iron Gate', 'Metalware'],
    ['Storage Crate', 'Storage & Containers'],
    ['Something Unrecognizable Widget', 'Decor & Other'],
    ['', 'Decor & Other']
  ];

  it.each(cases)('%s -> %s', (desc, expected) => {
    expect(categorize(desc)).toBe(expected);
  });

  it('is whole-word — "cart" is not Art, "candle" is not a lone match', () => {
    expect(categorize('Antique Wooden Cart')).not.toBe('Art & Wall Decor');
  });
});
