import { useNavigate } from 'react-router';
import SidebarItemsSidebar from '../../imports/SidebarItemsSidebar10';

export function EventPage() {
  const navigate = useNavigate();

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-name="Button"]')) {
      navigate('/checkout');
    }
  };

  return (
    <div className="w-screen h-screen bg-[#0a0a0a] overflow-hidden">
      <style>{`
        [data-name="Button"] { cursor: pointer !important; transition: filter 0.15s; }
        [data-name="Button"]:hover { filter: brightness(1.12); }
        body { font-family: 'DM Sans', sans-serif; }
      `}</style>
      <div className="size-full" onClick={handleClick}>
        <SidebarItemsSidebar />
      </div>
    </div>
  );
}
