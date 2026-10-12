export default function Badge({ type, children }) {
  const map = {
    new: 'badge-new',
    sale: 'badge-sale',
    'in-stock': 'badge-in-stock',
    'out-stock': 'badge-out-stock',
    verified: 'badge-verified',
  };
  return <span className={map[type] ?? 'badge bg-gray-100 text-gray-700'}>{children}</span>;
}
