'use client';

const PRICE_BRACKETS = [
  { label: 'Below €16', min: 0, max: 15.99 },
  { label: '€16 to €21.99', min: 16, max: 21.99 },
  { label: '€22 to €23.99', min: 22, max: 23.99 },
  { label: '€24 and Above', min: 24, max: Infinity },
];

export default function PriceRangeFilter({ products, minPrice, maxPrice, onChange }) {
  const getCounts = (bracket) =>
    products.filter((p) => p.price >= bracket.min && p.price <= bracket.max).length;

  const isActive = (bracket) =>
    String(minPrice) === String(bracket.min) && String(maxPrice) === String(bracket.max);

  const handleClick = (bracket) => {
    if (isActive(bracket)) {
      onChange('', '');
    } else {
      onChange(bracket.min, bracket.max);
    }
  };

  // This renders inside the category Sidebar, which is permanently black
  // (not theme-dependent) — text here needs to stay light regardless of the
  // light/dark toggle, not `dark:` conditional.
  return (
    <div className="">
      {/* <h6 className="mb-2 text-gray-400!">Find by Pricing</h6>
      <ul className="space-y-1">
        {PRICE_BRACKETS.map((bracket) => {
          const count = getCounts(bracket);
          const active = isActive(bracket);
          return (
            <li key={bracket.label}>
              <button
                onClick={() => handleClick(bracket)}
                className={`w-full text-left text-xs px-2 py-1.5 rounded flex justify-between items-center transition-colors duration-200
                  ${active
                    ? 'text-black font-semibold bg-primary-light'
                    : 'text-gray-300 hover:text-black hover:bg-primary-light'
                  }`}
              >
                <span>{bracket.label}</span>
                <span className="text-gray-500 font-normal">({count})</span>
              </button>
            </li>
          );
        })}
        {(minPrice !== '' || maxPrice !== '') && (
          <li>
            <button
              onClick={() => onChange('', '')}
              className="w-full text-left text-xs px-2 py-1 text-gray-400 hover:text-primary"
            >
              ✕ Clear price filter
            </button>
          </li>
        )}
      </ul> */}
    </div>
  );
}
