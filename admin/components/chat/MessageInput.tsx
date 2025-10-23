import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MessageInputProps {
  onSendMessage: () => void;
  disabled?: boolean;
  currentMessage: string;
  onMessageChange: (message: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  backgroundColor?: string;
}

const MessageInput = ({ 
  onSendMessage, 
  disabled = false, 
  currentMessage, 
  onMessageChange,
  onKeyDown,
  backgroundColor = '#0f0f0f'
}: MessageInputProps) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentMessage.trim() && !disabled) {
      onSendMessage();
    }
  };

  return (
    <form 
      onSubmit={handleSubmit} 
      className="flex gap-2 p-4 rounded-b-2xl"
      style={{ 
        backgroundColor,
        borderTop: '0.5px solid white'
      }}
    >
      <Input
        value={currentMessage}
        onChange={(e) => onMessageChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Type your message..."
        disabled={disabled}
        className="flex-1 text-white placeholder:text-slate-400 border-slate-600 focus:border-slate-500 focus:ring-slate-500"
        style={{
          backgroundColor: '#1a1a1a',
        }}
      />
      <Button
        type="submit"
        size="icon"
        disabled={!currentMessage.trim() || disabled}
        className="bg-white hover:bg-slate-200 text-slate-900 border-0 disabled:opacity-50"
      >
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
};

export default MessageInput;