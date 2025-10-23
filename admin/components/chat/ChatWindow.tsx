import { useEffect, useRef } from "react";
import { X, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import Message from "./Message";
import MessageInput from "./MessageInput";

interface ChatMessage {
  type: 'user' | 'ai';
  message: string;
  timestamp: Date;
}

interface ChatWindowProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  onSendMessage: () => void;
  isProcessing: boolean;
  currentMessage: string;
  onMessageChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

const ChatWindow = ({ 
  isOpen, 
  onClose, 
  messages, 
  onSendMessage, 
  isProcessing,
  currentMessage,
  onMessageChange,
  onKeyDown
}: ChatWindowProps) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = () => {
    onSendMessage();
  };

  const handleInputChange = (message: string) => {
    onMessageChange(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown(e);
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed bottom-16 right-6 w-96 h-[540px] rounded-2xl shadow-2xl flex flex-col z-40"
      style={{
        backgroundColor: '#070707ff',
        border: '0.5px solid white',
        transformOrigin: 'bottom right',
        animation: isOpen ? 'slideInFromButton 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55) forwards' : ''
      }}
    >
      {/* Header */}
      <div 
        className="flex items-center justify-between p-4 rounded-t-2xl"
        style={{ 
          backgroundColor: '#0c0c0cff',
          borderBottom: '0.5px solid white'
        }}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
            <Bot className="h-4 w-4 text-slate-900" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Porta</h3>
            <p className="text-xs text-slate-300">Transform Assistant</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8 text-slate-300 hover:text-white hover:bg-slate-700"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 thin-black-scrollbar" style={{ backgroundColor: '#0f0f0f' }}>
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3">
              <Bot className="h-6 w-6 text-slate-900" />
            </div>
              <p className="text-sm text-slate-300 mb-2">Hi, I'm Porta!</p>

              <p className="text-xs text-slate-400">Ask me to analyze, update, or clean your data.</p>
              <p className="text-xs text-slate-400">Be as specific as possible for best results.</p>
            </div>
        ) : (
          messages.map((message, index) => (
            <Message
              key={index}
              text={message.message}
              isUser={message.type === 'user'}
              timestamp={message.timestamp}
            />
          ))
        )}
        
        {isProcessing && (
          <div className="flex justify-start animate-fade-slide-in">
            <div 
              className="border border-gray-700 rounded-2xl rounded-bl-md px-4 py-3 shadow-lg"
              style={{ backgroundColor: '#0d0d0d' }}
            >
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse"></div>
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }}></div>
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <MessageInput 
        onSendMessage={handleSubmit}
        disabled={isProcessing}
        currentMessage={currentMessage}
        onMessageChange={handleInputChange}
        onKeyDown={handleKeyDown}
        backgroundColor="#0f0f0f"
      />
    </div>
  );
};

export default ChatWindow;