import { motion } from "framer-motion";
import { Cpu, ShieldCheck, Coins, Sparkles } from "lucide-react";

export const HeroAnimation = () => {
  const icons = [
    { Icon: Cpu, color: "text-emerald-400", delay: 0 },
    { Icon: ShieldCheck, color: "text-blue-400", delay: 0 },
    { Icon: Coins, color: "text-amber-400", delay: 0 },
    { Icon: Sparkles, color: "text-purple-400", delay: 0 },
  ];

  return (
    <div className="relative flex items-center justify-center w-[280px] h-[280px] sm:w-[400px] sm:h-[400px]">
      {/* Outer Rotating Dotted Circle */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        className="absolute w-full h-full border-2 border-dashed border-white/10 rounded-full"
      />

      {/* Inner Rotating Dotted Circle (Reverse) */}
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
        className="absolute w-[70%] h-[70%] border border-dashed border-emerald-500/20 rounded-full"
      />

      {/* Rotating Icons Container */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
        className="absolute w-full h-full"
      >
        {icons.map((item, i) => (
          <motion.div
            key={i}
            className={`absolute p-3 sm:p-4 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl ${item.color}`}
            style={{
              top: "50%",
              left: "50%",
              transform: `rotate(${i * 90}deg) translate(${window.innerWidth < 640 ? "140px" : "200px"}) rotate(-${i * 90}deg)`,
              marginTop: "-24px",
              marginLeft: "-24px",
            }}
            animate={{ rotate: -360 }} // Keep icons upright while container rotates
            transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          >
            <item.Icon className="w-5 h-5 sm:w-6 sm:h-6" />
          </motion.div>
        ))}
      </motion.div>

      {/* Central Brand Orbit */}
      <div className="relative z-10 w-20 h-20 sm:w-28 sm:h-28 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center backdrop-blur-3xl">
        <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-gradient-to-tr from-emerald-500 to-blue-500 blur-xl opacity-50 absolute animate-pulse" />
        <span className="text-2xl sm:text-3xl font-black italic text-emerald-400 tracking-tighter z-10">
          PH
        </span>
      </div>
    </div>
  );
};
