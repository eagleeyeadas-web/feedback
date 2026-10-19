import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import {
  Briefcase,
  Wrench,
  Warehouse,
  ClipboardList,
  ArrowRight,
  Shield,
  Truck,
  Eye,
  CheckCircle2,
  Sparkles,
  CalendarCheck,
  UserCheck,
} from 'lucide-react';

export default function LandingPage() {
  const navigate = useNavigate();

  const portals = [
    {
      id: 'sales',
      title: 'Sales Portal',
      subtitle: 'Sales & Client Intake',
      icon: Briefcase,
      description: 'Create installation jobs and manage customer quotations',
      buttonText: 'Sales Login',
      color: 'blue',
      badge: 'Sales & Quotations',
      action: () => navigate('/login?portal=sales'),
      buttonClass:
        'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 hover:shadow-blue-500/35',
      iconBg: 'bg-blue-50 text-blue-600 border-blue-200/60',
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
      features: ['Installation Checklists', 'Customer Quotations', 'Engineer Booking'],
    },
    {
      id: 'technical',
      title: 'Technical Team',
      subtitle: 'Field Operations & Service',
      icon: Wrench,
      description: 'View assigned jobs and submit installation reports',
      buttonText: 'Technical Login',
      color: 'teal',
      badge: 'Field Engineering',
      action: () => navigate('/login?portal=technical'),
      buttonClass:
        'bg-teal-600 hover:bg-teal-700 text-white shadow-teal-500/20 hover:shadow-teal-500/35',
      iconBg: 'bg-teal-50 text-teal-600 border-teal-200/60',
      badgeClass: 'bg-teal-50 text-teal-700 border-teal-200',
      features: ['Assigned Jobs Tracker', 'Device Carry Records', 'Installation Reports'],
    },
    {
      id: 'store',
      title: 'Store Manager',
      subtitle: 'Inventory & Dispatch',
      icon: Warehouse,
      description: 'Manage stock, device movements and returns',
      buttonText: 'Store Login',
      color: 'purple',
      badge: 'Stock & Logistics',
      action: () => navigate('/login?portal=store'),
      buttonClass:
        'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-500/20 hover:shadow-purple-500/35',
      iconBg: 'bg-purple-50 text-purple-600 border-purple-200/60',
      badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
      features: ['Inward Stock Receiving', 'Technician Returns', 'Hardware Audit Trail'],
    },
    {
      id: 'coordinator',
      title: 'Coordinator',
      subtitle: 'Travel & Accommodation',
      icon: CalendarCheck,
      description: 'Arrange travel, bus tickets and room bookings for technical jobs',
      buttonText: 'Coordinator Login',
      color: 'indigo',
      badge: 'Travel & Rooms',
      action: () => navigate('/login?portal=coordinator'),
      buttonClass:
        'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/20 hover:shadow-indigo-500/35',
      iconBg: 'bg-indigo-50 text-indigo-600 border-indigo-200/60',
      badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      features: ['Bus & Travel Arrangements', 'Room Bookings', 'WhatsApp Ticket Logistics'],
    },
    {
      id: 'hr',
      title: 'HR Portal',
      subtitle: 'Technician Availability & Extensions',
      icon: UserCheck,
      description: 'Manage engineer manual availability, review extension requests, and oversee field capacity',
      buttonText: 'HR Login',
      color: 'emerald',
      badge: 'Human Resources',
      action: () => navigate('/login?portal=hr'),
      buttonClass:
        'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20 hover:shadow-emerald-500/35',
      iconBg: 'bg-emerald-50 text-emerald-600 border-emerald-200/60',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      features: ['Manual Availability Controls', 'Extension Approvals', 'Availability Calendar'],
    },
    {
      id: 'customer',
      title: 'Customer Form',
      subtitle: 'Client Feedback & Review',
      icon: ClipboardList,
      description: 'Submit customer feedback and service evaluation',
      buttonText: 'Open Customer Form',
      color: 'navy',
      badge: 'Direct Client Access',
      action: () => navigate('/customer-form'),
      buttonClass:
        'bg-navy hover:bg-navy-light text-white shadow-navy/20 hover:shadow-navy/35',
      iconBg: 'bg-indigo-50 text-navy border-indigo-200/60',
      badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      features: ['5-Star Service Rating', 'Technician Evaluation', 'No Login Required'],
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-slate-100 selection:bg-blue-600 selection:text-white">
      {/* 1. White Header with Thin Red Accent Divider */}
      <Navbar />

      {/* 2. Hero Section with Dark Navy Background & ADAS Visual Accents */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#060f2e] via-[#0a1946] to-[#0c1f54] pt-12 pb-24 sm:pt-16 sm:pb-32 px-4 sm:px-6">
        {/* Subtle Ambient Glow and Grid Lines */}
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.4) 0%, transparent 65%), radial-gradient(circle at 80% 50%, rgba(139, 92, 246, 0.25) 0%, transparent 50%)',
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        <div className="max-w-4xl mx-auto text-center relative z-10">
          {/* ADAS Fleet Safety Tag */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-xs text-blue-200 font-semibold mb-5 shadow-inner">
            <Shield size={14} className="text-emerald-400" />
            <span>ADAS &amp; DMS Fleet Safety Intelligence</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>

          {/* Main Heading */}
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-tight">
            Welcome to{' '}
            <span className="bg-gradient-to-r from-blue-300 via-sky-200 to-white bg-clip-text text-transparent">
              Eagle Eye SafDrive
            </span>
          </h1>

          {/* Subtitle */}
          <p className="mt-3.5 text-base sm:text-lg text-blue-100/80 max-w-xl mx-auto font-medium">
            Choose a portal to continue
          </p>

          {/* Technology Highlights */}
          <div className="flex flex-wrap items-center justify-center gap-2.5 mt-5 text-[11px] font-medium text-blue-200/70">
            <span className="flex items-center gap-1.5 bg-white/5 backdrop-blur-sm px-3 py-1 rounded-lg border border-white/10">
              <Truck size={13} className="text-blue-400" /> Commercial Fleet Safety
            </span>
            <span className="flex items-center gap-1.5 bg-white/5 backdrop-blur-sm px-3 py-1 rounded-lg border border-white/10">
              <Eye size={13} className="text-teal-400" /> Intelligent Video Telematics
            </span>
            <span className="flex items-center gap-1.5 bg-white/5 backdrop-blur-sm px-3 py-1 rounded-lg border border-white/10">
              <CheckCircle2 size={13} className="text-emerald-400" /> ISO Certified Standards
            </span>
          </div>
        </div>
      </section>

      {/* 3. Four Portal Cards Section (Two-Column Desktop, Single-Column Mobile) */}
      <main className="flex-1 -mt-16 sm:-mt-20 max-w-4xl w-full mx-auto px-4 sm:px-6 pb-20 relative z-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
          {portals.map((portal) => {
            const IconComponent = portal.icon;
            return (
              <div
                key={portal.id}
                className="group bg-white rounded-2xl sm:rounded-3xl p-6 sm:p-7 shadow-xl shadow-navy/20 border border-gray-100/90 hover:border-gray-200 transition-all duration-300 flex flex-col justify-between hover:-translate-y-1.5 hover:shadow-2xl"
              >
                <div>
                  {/* Card Header: Icon & Badge */}
                  <div className="flex items-center justify-between mb-4">
                    <div
                      className={`w-13 h-13 rounded-2xl flex items-center justify-center border transition-transform duration-300 group-hover:scale-105 shadow-xs ${portal.iconBg}`}
                    >
                      <IconComponent size={26} strokeWidth={2.2} />
                    </div>

                    <span
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-full border tracking-wide uppercase ${portal.badgeClass}`}
                    >
                      {portal.badge}
                    </span>
                  </div>

                  {/* Title & Subtitle */}
                  <h2 className="text-xl font-bold text-gray-900 group-hover:text-navy transition-colors">
                    {portal.title}
                  </h2>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-0.5">
                    {portal.subtitle}
                  </p>

                  {/* Description */}
                  <p className="text-xs sm:text-sm text-gray-600 mt-3 leading-relaxed">
                    {portal.description}
                  </p>

                  {/* Key Highlights Bullet points */}
                  <ul className="mt-4 pt-4 border-t border-gray-100 space-y-1.5">
                    {portal.features.map((feature, idx) => (
                      <li
                        key={idx}
                        className="text-xs text-gray-500 flex items-center gap-2"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-300 group-hover:bg-blue-500 transition-colors" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Primary Action Button */}
                <div className="mt-6 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={portal.action}
                    className={`w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm transition-all duration-200 cursor-pointer ${portal.buttonClass}`}
                  >
                    <span>{portal.buttonText}</span>
                    <ArrowRight
                      size={16}
                      className="transition-transform group-hover:translate-x-1"
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* 4. Footer */}
      <footer className="border-t border-slate-800 bg-[#060f2e] text-slate-400 text-xs py-8 px-4 text-center">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-300 font-semibold">
            <Shield size={15} className="text-blue-400" />
            <span>EAGLE EYE SAFDRIVE PVT LTD</span>
          </div>
          <p className="text-slate-500 text-[11px]">
            &copy; {new Date().getFullYear()} Eagle Eye SafDrive. Enterprise Fleet Safety Management.
          </p>
          <div className="flex items-center gap-1.5 text-emerald-400 text-[11px] font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>All Systems Operational</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
