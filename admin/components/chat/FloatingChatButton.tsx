import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FloatingChatButtonProps {
  isOpen: boolean;
  onClick: () => void;
}

const FloatingChatButton = ({ isOpen, onClick }: FloatingChatButtonProps) => {
  return (
    <Button
      onClick={onClick}
      className={`fixed bottom-16 right-12 h-11 w-11 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 z-50 overflow-hidden ${
        isOpen ? 'opacity-0 scale-0 pointer-events-none' : 'opacity-100 scale-100'
      }`}
      style={{ backgroundColor: '#0a0a0a', padding: 0 }}
      size="icon"
    >
      {/* Orb border - part of the button */}
      <div className="absolute inset-0 rounded-full border-2 border-gray-400"></div>
      
      {/* Plain dark background */}
      <div className="absolute inset-0 bg-gray-950 rounded-full"></div>
      
      {/* Cloud-like flowing colors inside the orb */}
      <div className="absolute inset-0 rounded-full overflow-hidden">
        <div className="absolute inset-0 bg-gradient-radial from-purple-600 via-transparent to-purple-700 animate-cloud-flow opacity-90"></div>
        <div className="absolute inset-0 bg-gradient-radial from-blue-600 via-transparent to-indigo-700 animate-cloud-flow-2 opacity-85" style={{ animationDelay: '1s' }}></div>
        <div className="absolute inset-0 bg-gradient-radial from-pink-600 via-transparent to-rose-700 animate-cloud-flow-3 opacity-80" style={{ animationDelay: '2s' }}></div>
        <div className="absolute inset-0 bg-gradient-radial from-cyan-600 via-transparent to-teal-700 animate-cloud-flow-4 opacity-85" style={{ animationDelay: '3s' }}></div>
        <div className="absolute inset-0 bg-gradient-radial from-violet-600 via-transparent to-purple-800 animate-cloud-flow opacity-75" style={{ animationDelay: '4s' }}></div>
        <div className="absolute inset-0 bg-gradient-radial from-green-600 via-transparent to-emerald-700 animate-cloud-flow-2 opacity-70" style={{ animationDelay: '5s' }}></div>
        <div className="absolute inset-0 bg-gradient-radial from-orange-600 via-transparent to-red-700 animate-cloud-flow-3 opacity-75" style={{ animationDelay: '6s' }}></div>
        <div className="absolute inset-0 bg-gradient-radial from-yellow-500 via-transparent to-amber-700 animate-cloud-flow-4 opacity-65" style={{ animationDelay: '7s' }}></div>
      </div>
    </Button>
  );
};

export default FloatingChatButton;