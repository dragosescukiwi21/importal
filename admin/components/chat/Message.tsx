import { useEffect, useState } from "react";

interface MessageProps {
  text: string;
  isUser: boolean;
  timestamp: Date;
}

const Message = ({ text, isUser, timestamp }: MessageProps) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`chat-message-enter ${
        isVisible ? "opacity-100" : "opacity-0"
      } mb-4 transition-opacity duration-500`}
    >
      <div
        className={`flex ${
          isUser ? "justify-end" : "justify-start"
        } animate-fade-slide-in`}
      >
        <div
          className={`max-w-xs lg:max-w-md px-4 py-3 rounded-2xl ${
            isUser
              ? "text-white rounded-br-md border border-gray-600"
              : "border border-gray-700 text-white rounded-bl-md"
          } shadow-lg transition-all duration-300 hover:shadow-xl`}
          style={{
            backgroundColor: isUser ? '#1a1a1a' : '#0d0d0d'
          }}
        >
          <div className="text-sm">
            <span className="text-white">
              {text}
            </span>
          </div>
          <div
            className={`text-xs mt-2 ${
              isUser ? "text-slate-300" : "text-slate-400"
            }`}
          >
            {timestamp.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Message;