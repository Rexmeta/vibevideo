
import React, { useState } from 'react';
import { Icons } from './Icons';

export const PricingPage: React.FC = () => {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');

  const plans = [
    {
      name: 'Free',
      description: 'Perfect for experimenting with AI video creation.',
      price: 0,
      features: [
        '5 video credits / month',
        '720p HD Exports',
        'Standard processing speed',
        'Watermarked videos',
        'Standard Voices'
      ],
      cta: 'Start for Free',
      popular: false,
      color: 'bg-white',
      textColor: 'text-gray-900',
      buttonStyle: 'bg-gray-100 text-black hover:bg-gray-200'
    },
    {
      name: 'Pro',
      description: 'For creators who need high-quality content regularly.',
      price: billingCycle === 'yearly' ? 29 : 39,
      features: [
        '100 video credits / month',
        '4K Ultra HD Exports',
        'Priority processing (Fast)',
        'No Watermark',
        'Premium Neural Voices',
        'Commercial License',
        'Custom Brand Fonts'
      ],
      cta: 'Get Pro',
      popular: true,
      color: 'bg-brand-dark',
      textColor: 'text-white',
      buttonStyle: 'bg-brand-cyan text-black hover:brightness-110'
    },
    {
      name: 'Enterprise',
      description: 'Custom solutions for teams and high-volume needs.',
      price: 'Custom',
      features: [
        'Unlimited video generation',
        'API Access',
        'Dedicated Success Manager',
        'SSO & Custom Security',
        'Team Collaboration Workspace',
        'Custom Avatar Training',
        'SLA Support'
      ],
      cta: 'Contact Sales',
      popular: false,
      color: 'bg-white',
      textColor: 'text-gray-900',
      buttonStyle: 'bg-black text-white hover:bg-gray-800'
    }
  ];

  return (
    <div className="bg-gray-50 min-h-screen py-20 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h1 className="text-5xl font-black mb-6 tracking-tight">Simple pricing, <br/>unlimited creativity.</h1>
          <p className="text-xl text-gray-500 mb-10">Start for free, upgrade when you're ready. No hidden fees.</p>
          
          {/* Toggle */}
          <div className="inline-flex bg-white p-1.5 rounded-full border border-gray-200 shadow-sm relative">
            <button 
              onClick={() => setBillingCycle('monthly')}
              className={`px-8 py-3 rounded-full text-sm font-bold transition-all relative z-10 ${billingCycle === 'monthly' ? 'text-black' : 'text-gray-500 hover:text-black'}`}
            >
              Monthly
            </button>
            <button 
              onClick={() => setBillingCycle('yearly')}
              className={`px-8 py-3 rounded-full text-sm font-bold transition-all relative z-10 ${billingCycle === 'yearly' ? 'text-black' : 'text-gray-500 hover:text-black'}`}
            >
              Yearly <span className="text-[10px] text-green-600 bg-green-100 px-2 py-0.5 rounded-full ml-1">-20%</span>
            </button>
            <div 
              className={`absolute top-1.5 bottom-1.5 rounded-full bg-gray-100 transition-all duration-300 ease-out z-0 w-[calc(50%-6px)] ${billingCycle === 'monthly' ? 'left-1.5' : 'left-[calc(50%+3px)]'}`}
            ></div>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          {plans.map((plan) => (
            <div 
              key={plan.name}
              className={`relative rounded-[2.5rem] p-10 transition-all duration-300 ${plan.color} ${plan.popular ? 'shadow-2xl scale-105 border-none ring-4 ring-brand-cyan/20 z-10' : 'shadow-lg border border-gray-100 hover:-translate-y-2'}`}
            >
              {plan.popular && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-brand-cyan text-black px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest shadow-lg">
                  Most Popular
                </div>
              )}

              <div className="mb-8">
                <h3 className={`text-2xl font-black mb-2 ${plan.textColor}`}>{plan.name}</h3>
                <p className={`text-sm opacity-60 font-medium h-10 ${plan.textColor}`}>{plan.description}</p>
              </div>

              <div className={`flex items-baseline mb-8 ${plan.textColor}`}>
                {typeof plan.price === 'number' ? (
                  <>
                    <span className="text-5xl font-black">${plan.price}</span>
                    <span className="text-lg opacity-60 font-medium ml-2">/mo</span>
                  </>
                ) : (
                  <span className="text-4xl font-black">{plan.price}</span>
                )}
              </div>

              <button className={`w-full py-4 rounded-2xl font-black text-lg mb-10 transition-all shadow-md ${plan.buttonStyle}`}>
                {plan.cta}
              </button>

              <div className="space-y-4">
                <p className={`text-xs font-black uppercase tracking-widest opacity-40 mb-4 ${plan.textColor}`}>Features</p>
                {plan.features.map((feature, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${plan.popular ? 'bg-brand-cyan text-black' : 'bg-green-100 text-green-600'}`}>
                      <Icons.Check size={12} strokeWidth={4} />
                    </div>
                    <span className={`text-sm font-medium ${plan.textColor === 'text-white' ? 'text-gray-300' : 'text-gray-600'}`}>{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* FAQ / Trust Section */}
        <div className="mt-24 text-center max-w-4xl mx-auto">
           <h2 className="text-3xl font-black mb-12">Trusted by creative teams everywhere</h2>
           <div className="flex flex-wrap justify-center gap-12 opacity-40 grayscale">
              <div className="text-2xl font-black">ACME Corp</div>
              <div className="text-2xl font-black">GlobalBank</div>
              <div className="text-2xl font-black">StartUp.io</div>
              <div className="text-2xl font-black">MediaGroup</div>
              <div className="text-2xl font-black">Technic</div>
           </div>
        </div>
      </div>
    </div>
  );
};
