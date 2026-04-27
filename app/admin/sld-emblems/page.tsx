'use client';
import { useState } from 'react';
import { Download, Layers, Info } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Shared SVG constants (mirrored from sld-professional-renderer.ts)
// ─────────────────────────────────────────────────────────────────────────────
const BLK  = '#000000';
const WHT  = '#FFFFFF';
const GRN  = '#005500';
const SW_MED  = 1.5;
const SW_THIN = 1.0;
const SW_HAIR = 0.5;
const SW_BUS  = 3.5;

// ─────────────────────────────────────────────────────────────────────────────
// SVG primitive helpers (mirrored exactly from renderer)
// ─────────────────────────────────────────────────────────────────────────────
function ln(x1:number,y1:number,x2:number,y2:number,stroke=BLK,sw=SW_MED,dash?:string) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"${dash?` stroke-dasharray="${dash}"`:''}/>`;
}
function rect(x:number,y:number,w:number,h:number,fill=WHT,stroke=BLK,sw=SW_MED) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
function circ(cx:number,cy:number,r:number,fill=WHT,stroke=BLK,sw=SW_MED) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
function txt(x:number,y:number,s:string,sz=6.5,anc='middle',bold=false,fill=BLK,italic=false) {
  return `<text x="${x}" y="${y}" text-anchor="${anc}" font-size="${sz}" fill="${fill}"${bold?' font-weight="bold"':''}${italic?' font-style="italic"':''}>${s}</text>`;
}
function lug(cx:number,cy:number) {
  return circ(cx,cy,3,WHT,BLK,SW_MED)+circ(cx,cy,1,BLK,BLK,0);
}
function gnd(x:number,y:number,color=GRN) {
  return [ln(x,y,x,y+8,color,SW_MED),ln(x-9,y+8,x+9,y+8,color,SW_MED),ln(x-6,y+12,x+6,y+12,color,SW_MED),ln(x-3,y+16,x+3,y+16,color,SW_MED)].join('');
}
function calloutCircle(cx:number,cy:number,n:number) {
  return circ(cx,cy,10,WHT,BLK,SW_MED)+txt(cx,cy+1,String(n),8,'middle',true,BLK);
}
function busbar(x1:number,x2:number,y:number,label?:string) {
  const p=[ln(x1,y,x2,y,BLK,SW_BUS)];
  if(label) p.push(txt((x1+x2)/2,y-5,label,5.5,'middle',true,BLK));
  return p.join('');
}
function pvModuleSymbol(cx:number,cy:number,w=28,h=20) {
  return rect(cx-w/2,cy-h/2,w,h)+ln(cx-w/2,cy+h/2,cx+w/2,cy-h/2,BLK,SW_HAIR);
}
function fuseSymbol(cx:number,cy:number,w=16,h=8) {
  return [ln(cx-w/2-6,cy,cx-w/2,cy,BLK,SW_MED),rect(cx-w/2,cy-h/2,w,h),ln(cx+w/2,cy,cx+w/2+6,cy,BLK,SW_MED)].join('');
}
function breakerSymbol(cx:number,cy:number,w=18,h=12,amps?:number) {
  const p=[rect(cx-w/2,cy-h/2,w,h,WHT,BLK,SW_THIN),`<path d="M${cx-5},${cy+3} Q${cx},${cy-5} ${cx+5},${cy+3}" fill="none" stroke="${BLK}" stroke-width="${SW_HAIR}"/>`];
  if(amps) p.push(txt(cx,cy-h/2-3,`${amps}A`,5.5,'middle',true,BLK));
  return p.join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Emblem SVG builders — each returns full <svg>…</svg> string
// ─────────────────────────────────────────────────────────────────────────────

function svgWrap(w:number,h:number,content:string,vb?:string) {
  const v = vb ?? `0 0 ${w} ${h}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${v}" style="background:#fff;display:block;">${content}</svg>`;
}

const emblems: { id: string; label: string; sub: string; badge: string; badgeColor: string; svg: () => string }[] = [

  // ── PRIMITIVES ──────────────────────────────────────────────────────────────
  {
    id:'ground', label:'Ground (EGC/GES)', sub:'IEEE 315 — 3-line taper', badge:'Always', badgeColor:'blue',
    svg:()=>svgWrap(70,60,`${gnd(35,14,GRN)}`),
  },
  {
    id:'pv-module', label:'PV Module Symbol', sub:'IEEE/IEC — rectangle + diagonal', badge:'Always', badgeColor:'blue',
    svg:()=>svgWrap(80,60,pvModuleSymbol(40,30,54,38)),
  },
  {
    id:'inverter-symbol', label:'Inverter Symbol', sub:'IEEE — circle + sine wave ~', badge:'Always', badgeColor:'blue',
    svg:()=>svgWrap(90,80, circ(45,40,26)+`<path d="M37,40 Q41,32 45,40 Q49,48 53,40" fill="none" stroke="${BLK}" stroke-width="${SW_MED}"/>`),
  },
  {
    id:'meter-symbol', label:'Meter Symbol', sub:'Circle with M', badge:'Always', badgeColor:'blue',
    svg:()=>svgWrap(90,80, circ(45,40,26)+txt(45,45,'M',16,'middle',true,BLK)),
  },
  {
    id:'knife-switch', label:'Knife-Blade Disconnect', sub:'IEEE 315 — open blade position', badge:'Always', badgeColor:'blue',
    svg:()=>{
      const p=[ln(8,30,22,30),circ(22,30,3,BLK,BLK,0),ln(22,30,70,20),circ(74,30,3,WHT,BLK,SW_MED),ln(74,30,100,30)];
      return svgWrap(110,60,p.join(''));
    },
  },
  {
    id:'fuse', label:'Fuse Symbol', sub:'IEEE 315 — rectangle with leads', badge:'String only', badgeColor:'green',
    svg:()=>svgWrap(100,40,fuseSymbol(50,20)),
  },
  {
    id:'breaker', label:'Circuit Breaker', sub:'IEEE 315 — rectangle + arc', badge:'Always', badgeColor:'blue',
    svg:()=>svgWrap(80,50,breakerSymbol(40,26,22,14,30)),
  },
  {
    id:'lug', label:'Terminal Lug', sub:'Open circle with center dot', badge:'Always', badgeColor:'blue',
    svg:()=>svgWrap(50,50,lug(25,25)),
  },
  {
    id:'busbar', label:'Busbar', sub:'Heavy horizontal line', badge:'Always', badgeColor:'blue',
    svg:()=>svgWrap(200,40,busbar(10,190,22,'MAIN BUS')),
  },
  {
    id:'callout', label:'Callout Number', sub:'Equipment reference index', badge:'Always', badgeColor:'blue',
    svg:()=>svgWrap(60,50,calloutCircle(30,25,3)),
  },

  // ── EQUIPMENT BLOCKS ────────────────────────────────────────────────────────
  {
    id:'pv-array', label:'PV Array', sub:'2×3 grid of module symbols', badge:'Always', badgeColor:'blue',
    svg:()=>{
      const p:string[]=[];
      const W=80,H=64,cx=50,cy=62;
      p.push(rect(cx-W/2,cy-H/2,W,H));
      for(let row=0;row<2;row++) for(let col=0;col<3;col++) {
        const mx=cx-W/2+8+col*22,my=cy-H/2+10+row*24;
        p.push(pvModuleSymbol(mx+9,my+8,18,14));
      }
      p.push(txt(cx,cy-H/2-16,'PV ARRAY',8.5,'middle',true));
      p.push(txt(cx,cy-H/2-7,'18 × 400W',7,'middle',false));
      p.push(txt(cx,cy+H/2+10,'Silfab SIL-R MONO',6.5,'middle',false,BLK,true));
      p.push(txt(cx,cy+H/2+20,'3 strings × 6 panels',6.5,'middle'));
      p.push(calloutCircle(cx+W/2+14,cy-H/2-5,1));
      return svgWrap(130,140,p.join(''));
    },
  },
  {
    id:'roof-jbox', label:'Roof J-Box', sub:'Rectangle + X — DC/AC junction', badge:'Always', badgeColor:'blue',
    svg:()=>{
      const p:string[]=[];
      const W=44,H=44,cx=48,cy=55;
      p.push(rect(cx-W/2,cy-H/2,W,H));
      p.push(ln(cx-W/2+5,cy-H/2+5,cx+W/2-5,cy+H/2-5,BLK,SW_HAIR));
      p.push(ln(cx+W/2-5,cy-H/2+5,cx-W/2+5,cy+H/2-5,BLK,SW_HAIR));
      p.push(lug(cx-W/2+6,cy)); p.push(lug(cx+W/2-6,cy));
      p.push(txt(cx,cy-H/2-14,'ROOF J-BOX',7,'middle',true));
      p.push(txt(cx,cy-H/2-6,'DC JUNCTION',6.5,'middle'));
      p.push(txt(cx,cy+H/2+10,'3 strings',6.5,'middle'));
      p.push(calloutCircle(cx+W/2+14,cy-H/2-5,2));
      return svgWrap(115,125,p.join(''));
    },
  },
  {
    id:'dc-disconnect', label:'DC Disconnect', sub:'2-pole fused — string only', badge:'String only', badgeColor:'green',
    svg:()=>{
      const p:string[]=[];
      const dW=72,dH=48,cx=60,cy=60;
      p.push(rect(cx-dW/2,cy-dH/2,dW,dH));
      p.push(ln(cx-dW/2,cy-dH/2+13,cx+dW/2,cy-dH/2+13,BLK,SW_THIN));
      p.push(txt(cx,cy-dH/2+9,'DC DISCONNECT',5.5,'middle',true));
      p.push(lug(cx-dW/2+6,cy-7)); p.push(lug(cx-dW/2+6,cy+7));
      p.push(fuseSymbol(cx,cy-7)); p.push(fuseSymbol(cx,cy+7));
      p.push(lug(cx+dW/2-6,cy-7)); p.push(lug(cx+dW/2-6,cy+7));
      p.push(ln(cx-dW/2+9,cy-7,cx-8,cy-7,BLK,SW_THIN));
      p.push(ln(cx-dW/2+9,cy+7,cx-8,cy+7,BLK,SW_THIN));
      p.push(ln(cx+8,cy-7,cx+dW/2-9,cy-7,BLK,SW_THIN));
      p.push(ln(cx+8,cy+7,cx+dW/2-9,cy+7,BLK,SW_THIN));
      p.push(txt(cx,cy-dH/2-14,'(N) DC DISCONNECT',7,'middle',true));
      p.push(txt(cx,cy+dH/2+12,'15A FUSED',6.5,'middle'));
      p.push(txt(cx,cy+dH/2+22,'RAPID SHUTDOWN — NEC 690.12',6,'middle',false,BLK,true));
      p.push(calloutCircle(cx+dW/2+14,cy-dH/2-5,3));
      return svgWrap(140,135,p.join(''));
    },
  },
  {
    id:'ac-combiner', label:'AC Combiner', sub:'Branch breakers → combiner bus', badge:'Micro only', badgeColor:'purple',
    svg:()=>{
      const p:string[]=[];
      const W=90,H=80,cx=60,cy=70;
      p.push(rect(cx-W/2,cy-H/2,W,H));
      p.push(ln(cx-W/2,cy-H/2+13,cx+W/2,cy-H/2+13,BLK,SW_THIN));
      p.push(txt(cx,cy-H/2+9,'AC COMBINER',5.5,'middle',true));
      // 3 branch breakers
      [cx-22,cx,cx+22].forEach((bx,i)=>{
        p.push(breakerSymbol(bx,cy-H/2+26,14,10,20));
        p.push(ln(bx,cy-H/2+31,bx,cy-H/2+50,BLK,SW_THIN));
      });
      p.push(busbar(cx-W/2+8,cx+W/2-8,cy-H/2+50,'COMBINER BUS'));
      p.push(lug(cx+W/2-8,cy-H/2+50)); p.push(ln(cx+W/2-8,cy-H/2+50,cx+W/2,cy-H/2+50,BLK,SW_MED));
      p.push(txt(cx,cy-H/2-14,'AC COMBINER',8.5,'middle',true));
      p.push(txt(cx,cy+H/2+10,'3 branches / 20A OCPD ea.',6.5,'middle'));
      p.push(calloutCircle(cx+W/2+14,cy-H/2-5,3));
      return svgWrap(140,155,p.join(''));
    },
  },
  {
    id:'inverter-box', label:'Inverter Box', sub:'DC→AC arrow + sine wave', badge:'String only', badgeColor:'green',
    svg:()=>{
      const p:string[]=[];
      const W=96,H=80,cx=65,cy=68;
      p.push(rect(cx-W/2,cy-H/2,W,H));
      p.push(ln(cx-W/2,cy-H/2+14,cx+W/2,cy-H/2+14,BLK,SW_THIN));
      p.push(txt(cx,cy-H/2+10,'STRING INVERTER',5.5,'middle',true));
      // DC label, arrow, sine wave, AC label
      p.push(txt(cx-W/2+10,cy-4+4,'DC',7,'middle',true,'#555'));
      p.push(ln(cx-W/2+20,cy-4,cx+W/2-20,cy-4));
      p.push(`<path d="M${cx+W/2-22},${cy-9} L${cx+W/2-18},${cy-4} L${cx+W/2-22},${cy+1}" fill="${BLK}" stroke="${BLK}" stroke-width="1"/>`);
      const swX=cx+W/2-18;
      p.push(`<path d="M${swX-8},${cy-4} Q${swX-4},${cy-11} ${swX},${cy-4} Q${swX+4},${cy+3} ${swX+8},${cy-4}" fill="none" stroke="${BLK}" stroke-width="${SW_MED}"/>`);
      p.push(txt(cx+W/2-10,cy-4+4,'AC',7,'middle',true,'#555'));
      p.push(txt(cx,cy+H/2-26,'SolarEdge',6.5,'middle',false,BLK,true));
      p.push(txt(cx,cy+H/2-16,'SE7600H-US',7.5,'middle',true));
      p.push(txt(cx,cy+H/2-6,'7.60 kW / 32A',6.5,'middle'));
      p.push(lug(cx-W/2,cy)); p.push(ln(cx-W/2-10,cy,cx-W/2,cy));
      p.push(lug(cx+W/2,cy)); p.push(ln(cx+W/2,cy,cx+W/2+10,cy));
      p.push(txt(cx,cy+H/2+10,'MPPT: 2ch — 3 str/ch',6.5,'middle',false,'#555'));
      p.push(txt(cx,cy-H/2-16,'(N) INVERTER',8.5,'middle',true));
      p.push(calloutCircle(cx+W/2+14,cy-H/2-5,4));
      return svgWrap(160,155,p.join(''));
    },
  },
  {
    id:'ac-disconnect', label:'AC Disconnect', sub:'Dual knife-blade, non-fused', badge:'Always', badgeColor:'blue',
    svg:()=>{
      const p:string[]=[];
      const W=90,H=56,cx=60,cy=60;
      p.push(rect(cx-W/2,cy-H/2,W,H));
      p.push(ln(cx-W/2,cy-H/2+13,cx+W/2,cy-H/2+13,BLK,SW_THIN));
      p.push(txt(cx,cy-H/2+9,'AC DISCONNECT',5.5,'middle',true));
      // Two knife switches
      [-8,8].forEach(off=>{
        const y=cy+off;
        p.push(lug(cx-W/2+6,y)); p.push(ln(cx-W/2+6,y,cx-W/2+16,y));
        p.push(circ(cx-W/2+16,y,3,BLK,BLK,0));
        p.push(ln(cx-W/2+16,y,cx+W/2-22,y+(off>0?8:-8)));
        p.push(circ(cx+W/2-18,y,3,WHT,BLK,SW_MED));
        p.push(lug(cx+W/2-6,y)); p.push(ln(cx+W/2-6,y,cx+W/2-18,y));
      });
      p.push(txt(cx,cy-H/2-16,'(N) AC DISCONNECT',8.5,'middle',true));
      p.push(txt(cx,cy+H/2+12,'30A NON-FUSED',6.5,'middle'));
      p.push(calloutCircle(cx+W/2+14,cy-H/2-5,5));
      return svgWrap(150,130,p.join(''));
    },
  },
  {
    id:'msp-load', label:'MSP — Load Side', sub:'Main breaker + bus + PV backfed breaker', badge:'Load-side', badgeColor:'green',
    svg:()=>{
      const CLR='#1B5E20';
      const p:string[]=[];
      const W=110,H=100,cx=70,cy=80;
      p.push(rect(cx-W/2,cy-H/2,W,H,WHT,CLR,SW_MED));
      p.push(ln(cx-W/2,cy-H/2+14,cx+W/2,cy-H/2+14,CLR,SW_THIN));
      p.push(txt(cx,cy-H/2+10,'MAIN SERVICE PANEL',5.5,'middle',true,CLR));
      // Main breaker
      p.push(breakerSymbol(cx,cy-H/2+30,28,14,200));
      p.push(txt(cx,cy-H/2+24,'200A MAIN',5,'middle',true,CLR));
      // Main bus
      p.push(busbar(cx-W/2+8,cx+W/2-8,cy-H/2+52,'MAIN BUS'));
      p.push(ln(cx,cy-H/2+37,cx,cy-H/2+52,BLK,SW_MED));
      // PV breaker drop
      const pvBkX=cx+20;
      p.push(ln(pvBkX,cy-H/2+52,pvBkX,cy-H/2+62,CLR,SW_THIN));
      p.push(breakerSymbol(pvBkX,cy-H/2+70,20,12,30));
      p.push(txt(pvBkX,cy-H/2+60,'30A PV',5,'middle',true,CLR));
      p.push(lug(pvBkX,cy-H/2+90));
      p.push(ln(pvBkX,cy-H/2+76,pvBkX,cy-H/2+87,CLR,SW_MED));
      // Bus out lug right
      p.push(lug(cx+W/2,cy-H/2+52)); p.push(ln(cx+W/2,cy-H/2+52,cx+W/2+10,cy-H/2+52,BLK,SW_MED));
      p.push(txt(cx,cy-H/2-16,'MSP — LOAD SIDE',8.5,'middle',true,CLR));
      p.push(txt(cx,cy+H/2+12,'200A / LOAD-SIDE TAP',6.5,'middle',false,CLR));
      p.push(txt(cx,cy+H/2+22,'NEC 705.12(B) — 120% Rule',6,'middle',false,BLK,true));
      p.push(calloutCircle(cx+W/2+14,cy-H/2-5,6));
      return svgWrap(165,180,p.join(''));
    },
  },
  {
    id:'utility-meter', label:'Utility Meter + Grid', sub:'M circle + UTIL GRID circle + ground', badge:'Always', badgeColor:'blue',
    svg:()=>{
      const p:string[]=[];
      const cx=55,mR=24;
      p.push(txt(cx,14,'UTILITY METER',8.5,'middle',true));
      p.push(txt(cx,23,'SCE',7,'middle'));
      p.push(circ(cx,50,mR));
      p.push(txt(cx,55,'M',16,'middle',true));
      p.push(ln(8,50,cx-mR,50));
      p.push(ln(cx,50+mR,cx,88));
      p.push(circ(cx,104,16)); 
      p.push(txt(cx,101,'UTIL',5.5,'middle',true)); 
      p.push(txt(cx,109,'GRID',5,'middle'));
      p.push(txt(cx,126,'UTILITY GRID',6.5,'middle',true));
      p.push(txt(cx,136,'SCE',6.5,'middle'));
      p.push(ln(cx,120,cx,130));
      p.push(gnd(cx,130,GRN));
      p.push(calloutCircle(cx+mR+14,14,7));
      return svgWrap(120,165,p.join(''));
    },
  },

  // ── OPTIONAL ────────────────────────────────────────────────────────────────
  {
    id:'battery', label:'Battery Storage', sub:'IEC 60617 cell stack — blue', badge:'hasBattery', badgeColor:'yellow',
    svg:()=>{
      const CLR='#1565C0';
      const p:string[]=[];
      const W=88,H=72,cx=60,cy=60;
      p.push(rect(cx-W/2,cy-H/2,W,H,WHT,CLR,SW_MED));
      p.push(ln(cx-W/2,cy-H/2+14,cx+W/2,cy-H/2+14,CLR,SW_THIN));
      p.push(txt(cx,cy-H/2+10,'BATTERY STORAGE',5.5,'middle',true,CLR));
      // IEC 60617 cell stack — 3 cells
      const cellX=cx-14,cellY=cy-4;
      for(let i=0;i<3;i++) {
        const lx=cellX+i*9;
        p.push(ln(lx,cellY-12,lx,cellY+12,CLR,2.5));
        if(i<2) p.push(ln(lx+4,cellY-7,lx+4,cellY+7,CLR,1.5));
      }
      p.push(txt(cellX-10,cellY+4,'−',10,'middle',true,CLR));
      p.push(txt(cellX+28,cellY+4,'+',10,'middle',true,CLR));
      // AC OUT lug at bottom
      p.push(lug(cx,cy+H/2-6));
      p.push(ln(cx,cy+H/2-6,cx,cy+H/2,CLR,SW_MED));
      p.push(txt(cx,cy+H/2+8,'AC OUT',4,'middle',false,CLR));
      p.push(txt(cx,cy+H/2+20,'Enphase IQ Battery 5P',6.5,'middle',false,BLK,true));
      p.push(txt(cx,cy+H/2+30,'5.0 kWh',6.5,'middle',true,CLR));
      p.push(txt(cx,cy+H/2+40,'20A BACKFEED — NEC 705.12(B)',6,'middle',false,CLR));
      p.push(calloutCircle(cx+W/2+14,cy-H/2-5,9));
      return svgWrap(145,170,p.join(''));
    },
  },
  {
    id:'bui-enphase', label:'BUI — Enphase IQ SC3', sub:'GRID + GEN + LOAD + BATTERY ports — blue', badge:'hasBattery', badgeColor:'yellow',
    svg:()=>{
      const CLR='#0D47A1';
      const p:string[]=[];
      const W=100,H=90,cx=70,cy=75;
      p.push(rect(cx-W/2,cy-H/2,W,H,WHT,CLR,SW_MED));
      p.push(ln(cx-W/2,cy-H/2+14,cx+W/2,cy-H/2+14,CLR,SW_THIN));
      p.push(txt(cx,cy-H/2+10,'IQ SYSTEM CONTROLLER 3',5.5,'middle',true,CLR));
      const gridY=cy-14,genY=cy+14;
      // GRID port
      p.push(lug(cx-W/2+8,gridY)); p.push(txt(cx-W/2+8,gridY-8,'GRID',4.5,'middle',false,'#444'));
      p.push(ln(cx-W/2,gridY,cx-W/2+8,gridY,CLR,SW_MED));
      // GEN port
      p.push(lug(cx-W/2+8,genY)); p.push(txt(cx-W/2+8,genY+9,'GEN',4.5,'middle',false,'#2E7D32'));
      p.push(ln(cx-W/2,genY,cx-W/2+8,genY,'#2E7D32',SW_MED));
      // GRID blade closed
      p.push(ln(cx-W/2+11,gridY,cx-W/2+44,gridY,CLR,SW_MED));
      p.push(circ(cx-W/2+11,gridY,2.5,CLR,CLR,0));
      p.push(circ(cx-W/2+44,gridY,2.5,WHT,CLR,SW_THIN));
      // GEN blade open
      p.push(ln(cx-W/2+11,genY,cx-W/2+32,genY-12,'#2E7D32',SW_MED));
      p.push(circ(cx-W/2+11,genY,2.5,'#2E7D32','#2E7D32',0));
      p.push(circ(cx-W/2+44,genY,2.5,WHT,'#2E7D32',SW_THIN));
      // Internal bus
      const busX=cx-W/2+57;
      p.push(ln(busX,gridY,busX,genY,CLR,2.5));
      p.push(ln(cx-W/2+44,gridY,busX,gridY,CLR,SW_THIN));
      p.push(ln(cx-W/2+44,genY,busX,genY,CLR,SW_THIN));
      // LOAD port
      p.push(lug(cx+W/2-8,cy)); p.push(txt(cx+W/2-8,cy-8,'LOAD',4.5,'middle',false,'#444'));
      p.push(ln(busX,cy,cx+W/2-8,cy,CLR,SW_MED)); p.push(ln(cx+W/2-8,cy,cx+W/2,cy,CLR,SW_MED));
      // BATTERY port bottom
      p.push(lug(cx,cy+H/2-4)); p.push(txt(cx,cy+H/2+8,'BATTERY',4.5,'middle',false,CLR));
      p.push(ln(cx,cy+H/2-4,cx,cy+H/2,CLR,SW_MED));
      p.push(txt(cx,cy+H/2+22,'Enphase IQ SC3',6.5,'middle',false,CLR,true));
      p.push(txt(cx,cy+H/2+32,'200A',6.5,'middle',true,CLR));
      p.push(txt(cx,cy+H/2+42,'NEC 706 / NEC 230.82 / UL 1741-SA',6,'middle',false,CLR,true));
      p.push(calloutCircle(cx+W/2+14,cy-H/2-5,8));
      return svgWrap(175,195,p.join(''));
    },
  },
  {
    id:'bui-tesla', label:'BUI — Tesla Backup Gateway 2', sub:'Same layout, red — no GEN port', badge:'hasBattery + Tesla', badgeColor:'yellow',
    svg:()=>{
      const CLR='#CC0000';
      const p:string[]=[];
      const W=100,H=90,cx=70,cy=75;
      p.push(rect(cx-W/2,cy-H/2,W,H,WHT,CLR,SW_MED));
      p.push(ln(cx-W/2,cy-H/2+14,cx+W/2,cy-H/2+14,CLR,SW_THIN));
      p.push(txt(cx,cy-H/2+10,'BACKUP GATEWAY 2',5.5,'middle',true,CLR));
      const gridY=cy;
      p.push(lug(cx-W/2+8,gridY)); p.push(txt(cx-W/2+8,gridY-8,'GRID',4.5,'middle',false,'#444'));
      p.push(ln(cx-W/2,gridY,cx-W/2+8,gridY,CLR,SW_MED));
      p.push(ln(cx-W/2+11,gridY,cx-W/2+44,gridY,CLR,SW_MED));
      p.push(circ(cx-W/2+11,gridY,2.5,CLR,CLR,0));
      p.push(circ(cx-W/2+44,gridY,2.5,WHT,CLR,SW_THIN));
      const busX=cx-W/2+57;
      p.push(ln(busX,gridY-10,busX,gridY+10,CLR,2.5));
      p.push(ln(cx-W/2+44,gridY,busX,gridY,CLR,SW_THIN));
      p.push(lug(cx+W/2-8,cy)); p.push(txt(cx+W/2-8,cy-8,'LOAD',4.5,'middle',false,'#444'));
      p.push(ln(busX,cy,cx+W/2-8,cy,CLR,SW_MED)); p.push(ln(cx+W/2-8,cy,cx+W/2,cy,CLR,SW_MED));
      p.push(lug(cx,cy+H/2-4)); p.push(txt(cx,cy+H/2+8,'BATTERY',4.5,'middle',false,CLR));
      p.push(ln(cx,cy+H/2-4,cx,cy+H/2,CLR,SW_MED));
      p.push(txt(cx,cy+H/2+22,'Tesla Backup Gateway 2',6.5,'middle',false,CLR,true));
      p.push(txt(cx,cy+H/2+32,'200A',6.5,'middle',true,CLR));
      p.push(calloutCircle(cx+W/2+14,cy-H/2-5,8));
      return svgWrap(175,175,p.join(''));
    },
  },
  {
    id:'bui-generic', label:'BUI — Generic', sub:'Blue, no brand-specific header', badge:'hasBattery', badgeColor:'yellow',
    svg:()=>{
      const CLR='#1565C0';
      const p:string[]=[];
      const W=100,H=90,cx=70,cy=75;
      p.push(rect(cx-W/2,cy-H/2,W,H,WHT,CLR,SW_MED));
      p.push(ln(cx-W/2,cy-H/2+14,cx+W/2,cy-H/2+14,CLR,SW_THIN));
      p.push(txt(cx,cy-H/2+10,'BACKUP INTERFACE UNIT',5.5,'middle',true,CLR));
      const gridY=cy;
      p.push(lug(cx-W/2+8,gridY)); p.push(txt(cx-W/2+8,gridY-8,'GRID',4.5,'middle',false,'#444'));
      p.push(ln(cx-W/2,gridY,cx-W/2+8,gridY,CLR,SW_MED));
      p.push(ln(cx-W/2+11,gridY,cx-W/2+44,gridY,CLR,SW_MED));
      p.push(circ(cx-W/2+11,gridY,2.5,CLR,CLR,0));
      p.push(circ(cx-W/2+44,gridY,2.5,WHT,CLR,SW_THIN));
      const busX=cx-W/2+57;
      p.push(ln(busX,gridY-10,busX,gridY+10,CLR,2.5));
      p.push(ln(cx-W/2+44,gridY,busX,gridY,CLR,SW_THIN));
      p.push(lug(cx+W/2-8,cy)); p.push(txt(cx+W/2-8,cy-8,'LOAD',4.5,'middle',false,'#444'));
      p.push(ln(busX,cy,cx+W/2-8,cy,CLR,SW_MED)); p.push(ln(cx+W/2-8,cy,cx+W/2,cy,CLR,SW_MED));
      p.push(lug(cx,cy+H/2-4)); p.push(txt(cx,cy+H/2+8,'BATTERY',4.5,'middle',false,CLR));
      p.push(ln(cx,cy+H/2-4,cx,cy+H/2,CLR,SW_MED));
      p.push(txt(cx,cy+H/2+22,'Generic BUI',6.5,'middle',false,CLR,true));
      p.push(txt(cx,cy+H/2+32,'200A',6.5,'middle',true,CLR));
      p.push(txt(cx,cy+H/2+42,'NEC 706 / UL 1741',6,'middle',false,CLR,true));
      p.push(calloutCircle(cx+W/2+14,cy-H/2-5,8));
      return svgWrap(175,175,p.join(''));
    },
  },
  {
    id:'backup-panel', label:'Backup Sub-Panel', sub:'Main breaker + 3 branch breakers — purple', badge:'hasBackupPanel', badgeColor:'yellow',
    svg:()=>{
      const CLR='#6A1B9A';
      const p:string[]=[];
      const W=80,H=72,cx=60,cy=66;
      p.push(rect(cx-W/2,cy-H/2,W,H,WHT,CLR,SW_MED));
      p.push(ln(cx-W/2,cy-H/2+14,cx+W/2,cy-H/2+14,CLR,SW_THIN));
      p.push(txt(cx,cy-H/2+10,'BACKUP SUB-PANEL',5.5,'middle',true,CLR));
      p.push(breakerSymbol(cx,cy-H/2+26,28,12,100));
      p.push(txt(cx,cy-H/2+20,'100A MAIN',5,'middle',true,CLR));
      const busY=cy-H/2+44;
      p.push(busbar(cx-W/2+8,cx+W/2-8,busY,'CRIT. LOADS BUS'));
      p.push(ln(cx,cy-H/2+32,cx,busY,BLK,SW_MED));
      [-22,0,22].forEach(off=>{
        p.push(ln(cx+off,busY,cx+off,busY+14,CLR,SW_THIN));
        p.push(breakerSymbol(cx+off,busY+20,14,10));
      });
      p.push(lug(cx-W/2,cy-H/2+44)); p.push(ln(cx-W/2-10,cy-H/2+44,cx-W/2,cy-H/2+44,CLR,SW_MED));
      p.push(txt(cx,cy-H/2-14,'BACKUP SUB-PANEL',8.5,'middle',true,CLR));
      p.push(txt(cx,cy+H/2+12,'Enphase',6.5,'middle',false,CLR,true));
      p.push(txt(cx,cy+H/2+22,'CRITICAL LOADS ONLY',6.5,'middle',false,CLR));
      p.push(calloutCircle(cx+W/2+14,cy-H/2-5,10));
      return svgWrap(150,165,p.join(''));
    },
  },
  {
    id:'generator', label:'Generator', sub:'Circle with G + sine wave — green', badge:'generatorKw > 0', badgeColor:'yellow',
    svg:()=>{
      const CLR='#2E7D32';
      const p:string[]=[];
      const r=30,cx=55,cy=70;
      p.push(circ(cx,cy,r,WHT,CLR,SW_MED));
      p.push(txt(cx,cy+6,'G',18,'middle',true,CLR));
      p.push(`<path d="M${cx-8},${cy+14} Q${cx-4},${cy+10} ${cx},${cy+14} Q${cx+4},${cy+18} ${cx+8},${cy+14}" fill="none" stroke="${CLR}" stroke-width="${SW_THIN}"/>`);
      p.push(lug(cx+r,cy)); p.push(ln(cx+r,cy,cx+r+12,cy,CLR,SW_MED));
      p.push(txt(cx+r+2,cy-7,'GEN OUT',4,'start',false,CLR));
      p.push(txt(cx,cy-r-18,'STANDBY GENERATOR',8.5,'middle',true,CLR));
      p.push(txt(cx,cy-r-8,'Generac 14kW',7,'middle',false,CLR));
      p.push(txt(cx,cy+r+10,'14 kW / 58A',6.5,'middle',true,CLR));
      p.push(txt(cx,cy+r+20,'NEC 702.5 — TRANSFER EQUIP. REQ.',6,'middle',false,CLR,true));
      p.push(calloutCircle(cx+r+14,cy-r-5,11));
      return svgWrap(150,170,p.join(''));
    },
  },
  {
    id:'ats', label:'ATS — Standalone', sub:'UTIL + GEN blades + LOAD output — orange', badge:'generatorKw > 0, no IQ SC3', badgeColor:'yellow',
    svg:()=>{
      const CLR='#E65100';
      const p:string[]=[];
      const W=90,H=68,cx=70,cy=70;
      p.push(rect(cx-W/2,cy-H/2,W,H,WHT,CLR,SW_MED));
      p.push(ln(cx-W/2,cy-H/2+14,cx+W/2,cy-H/2+14,CLR,SW_THIN));
      p.push(txt(cx,cy-H/2+10,'AUTO TRANSFER SWITCH',5.5,'middle',true,CLR));
      const utilY=cy-12,genY=cy+12;
      p.push(lug(cx-W/2+8,utilY)); p.push(txt(cx-W/2+8,utilY-8,'UTIL',4.5,'middle',false,'#444'));
      p.push(ln(cx-W/2,utilY,cx-W/2+8,utilY,CLR,SW_MED));
      p.push(lug(cx-W/2+8,genY)); p.push(txt(cx-W/2+8,genY+10,'GEN',4.5,'middle',false,CLR));
      p.push(ln(cx-W/2,genY,cx-W/2+8,genY,CLR,SW_MED));
      // UTIL blade closed
      p.push(ln(cx-W/2+11,utilY,cx-W/2+40,utilY,CLR,SW_MED));
      p.push(circ(cx-W/2+11,utilY,2.5,CLR,CLR,0)); p.push(circ(cx-W/2+40,utilY,2.5,WHT,CLR,SW_THIN));
      // GEN blade open
      p.push(ln(cx-W/2+11,genY,cx-W/2+32,genY-10,CLR,SW_MED));
      p.push(circ(cx-W/2+11,genY,2.5,CLR,CLR,0)); p.push(circ(cx-W/2+40,genY,2.5,WHT,CLR,SW_THIN));
      // Internal bus
      const busX=cx-W/2+52;
      p.push(ln(busX,utilY,busX,genY,CLR,2.5));
      p.push(ln(cx-W/2+40,utilY,busX,utilY,CLR,SW_THIN));
      p.push(ln(cx-W/2+40,genY,busX,genY,CLR,SW_THIN));
      // LOAD
      p.push(lug(cx+W/2-8,cy)); p.push(txt(cx+W/2-8,cy-8,'LOAD',4.5,'middle',false,'#444'));
      p.push(ln(busX,cy,cx+W/2-8,cy,CLR,SW_MED)); p.push(ln(cx+W/2-8,cy,cx+W/2,cy,CLR,SW_MED));
      p.push(txt(cx,cy-H/2-16,'ATS',8.5,'middle',true,CLR));
      p.push(txt(cx,cy+H/2+12,'Generac 200A',6.5,'middle',false,CLR,true));
      p.push(txt(cx,cy+H/2+22,'200A RATED',6.5,'middle',true,CLR));
      p.push(txt(cx,cy+H/2+32,'NEC 702.5 — AUTO TRANSFER',6,'middle',false,CLR,true));
      p.push(calloutCircle(cx+W/2+14,cy-H/2-5,11));
      return svgWrap(175,175,p.join(''));
    },
  },
];

const WIRE_TYPES = [
  { id:'ac-conduit',    label:'AC Conductor in Conduit', sub:'THWN-2 — all AC runs',                                        stroke:'#000000', dash:undefined,  sw:1.5 },
  { id:'pv-openair',   label:'Open Air — PV Wire / THWN-2', sub:'NEC 690.31 — roof to J-Box',                              stroke:'#005500', dash:'10,5',     sw:1.5 },
  { id:'egc',          label:'Equipment Grounding Conductor (EGC)', sub:'Grounding rail — NEC 250.122 / NEC 690.43',         stroke:'#005500', dash:undefined,  sw:1.5 },
  { id:'dc-conduit',   label:'DC Conductor in Conduit', sub:'USE-2/PV Wire — DC runs',                                       stroke:'#000000', dash:'4,2',      sw:1.5 },
  { id:'battery-ac',   label:'Battery AC-Coupled Connection', sub:'Battery AC OUT → BUI BATTERY port',                       stroke:'#1565C0', dash:'6,3',      sw:1.5 },
  { id:'gen-output',   label:'Generator Output Conductor', sub:'Gen → BUI GEN port or ATS GEN input',                        stroke:'#2E7D32', dash:undefined,  sw:1.5 },
  { id:'ats-transfer', label:'ATS Transfer Conductor', sub:'ATS LOAD output → MSP',                                           stroke:'#E65100', dash:undefined,  sw:1.5 },
  { id:'backup-feeder',label:'Backup Sub-Panel Feeder', sub:'BUI LOAD port → Backup Sub-Panel',                               stroke:'#6A1B9A', dash:undefined,  sw:1.5 },
];

const BADGE_STYLES: Record<string,string> = {
  blue:   'bg-blue-500/20 text-blue-400',
  green:  'bg-green-500/20 text-green-400',
  purple: 'bg-purple-500/20 text-purple-400',
  yellow: 'bg-amber-500/20 text-amber-400',
};

function wireSVG(stroke:string, dash:string|undefined, sw:number) {
  const da = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="24" viewBox="0 0 120 24" style="display:block;"><line x1="4" y1="12" x2="116" y2="12" stroke="${stroke}" stroke-width="${sw}"${da}/></svg>`;
}

function buildFullSVG(): string {
  const sections = [
    { title: 'PRIMITIVE SYMBOLS (IEEE 315)', ids: ['ground','pv-module','inverter-symbol','meter-symbol','knife-switch','fuse','breaker','lug','busbar','callout'] },
    { title: 'EQUIPMENT BLOCKS — ALWAYS RENDERED', ids: ['pv-array','roof-jbox','ac-disconnect','utility-meter'] },
    { title: 'EQUIPMENT BLOCKS — STRING TOPOLOGY', ids: ['dc-disconnect','inverter-box'] },
    { title: 'EQUIPMENT BLOCKS — MICROINVERTER TOPOLOGY', ids: ['ac-combiner'] },
    { title: 'EQUIPMENT BLOCKS — MSP', ids: ['msp-load'] },
    { title: 'OPTIONAL BLOCKS (BATTERY + STORAGE)', ids: ['battery','bui-enphase','bui-tesla','bui-generic','backup-panel'] },
    { title: 'OPTIONAL BLOCKS (GENERATOR + TRANSFER)', ids: ['generator','ats'] },
  ];

  const allByMap = Object.fromEntries(emblems.map(e=>[e.id,e]));
  let y = 60;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="3200" style="background:#fff;font-family:monospace;">`);
  parts.push(`<rect width="1400" height="3200" fill="#fff"/>`);
  parts.push(`<text x="700" y="36" text-anchor="middle" font-size="20" font-weight="bold" fill="#000">SolarPro — SLD Emblem Reference</text>`);
  parts.push(`<text x="700" y="52" text-anchor="middle" font-size="11" fill="#555">sld-professional-renderer.ts — IEEE 315 / ANSI Standard</text>`);
  y = 80;

  for (const section of sections) {
    y += 30;
    parts.push(`<rect x="20" y="${y}" width="1360" height="22" fill="#1a1a1a"/>`);
    parts.push(`<text x="30" y="${y+15}" font-size="10" font-weight="bold" fill="#fff">${section.title}</text>`);
    y += 32;
    let x = 30;
    let maxH = 0;
    for (const id of section.ids) {
      const e = allByMap[id];
      if (!e) continue;
      const svgStr = e.svg();
      // Extract width/height from svg tag
      const wm = svgStr.match(/width="(\d+)"/); const hm = svgStr.match(/height="(\d+)"/);
      const sw = wm ? parseInt(wm[1]) : 120; const sh = hm ? parseInt(hm[1]) : 120;
      const cardW = Math.max(sw + 20, 160);
      // Background card
      parts.push(`<rect x="${x}" y="${y}" width="${cardW}" height="${sh+50}" rx="6" fill="#f8f8f8" stroke="#ddd" stroke-width="1"/>`);
      // Embed SVG via foreignObject isn't supported in standalone — inline as nested svg
      parts.push(`<svg x="${x+10}" y="${y+8}" width="${sw}" height="${sh}">${svgStr.replace(/<svg[^>]*>/,'').replace('</svg>','')}</svg>`);
      parts.push(`<text x="${x+cardW/2}" y="${y+sh+20}" text-anchor="middle" font-size="9" font-weight="bold" fill="#111">${e.label}</text>`);
      parts.push(`<text x="${x+cardW/2}" y="${y+sh+32}" text-anchor="middle" font-size="7" fill="#555">${e.sub}</text>`);
      parts.push(`<rect x="${x+cardW/2-30}" y="${y+sh+36}" width="60" height="12" rx="4" fill="#e0e0e0"/>`);
      parts.push(`<text x="${x+cardW/2}" y="${y+sh+45}" text-anchor="middle" font-size="7" fill="#333">${e.badge}</text>`);
      maxH = Math.max(maxH, sh+50);
      x += cardW + 16;
      if (x > 1300) { x = 30; y += maxH + 12; maxH = 0; }
    }
    if (x > 30) y += maxH + 12;
  }

  // Wire types section
  y += 30;
  parts.push(`<rect x="20" y="${y}" width="1360" height="22" fill="#1a1a1a"/>`);
  parts.push(`<text x="30" y="${y+15}" font-size="10" font-weight="bold" fill="#fff">WIRE / CONDUCTOR TYPES</text>`);
  y += 32;
  for (const w of WIRE_TYPES) {
    const da = w.dash ? ` stroke-dasharray="${w.dash}"` : '';
    parts.push(`<line x1="30" y1="${y+8}" x2="180" y2="${y+8}" stroke="${w.stroke}" stroke-width="${w.sw}"${da}/>`);
    parts.push(`<text x="194" y="${y+12}" font-size="10" font-weight="bold" fill="#111">${w.label}</text>`);
    parts.push(`<text x="194" y="${y+23}" font-size="8" fill="#555">${w.sub}</text>`);
    y += 34;
  }

  parts.push('</svg>');
  return parts.join('\n');
}

export default function SLDEmblemsPage() {
  const [zoom, setZoom] = useState(1);
  const [activeSection, setActiveSection] = useState<string>('all');

  const sections = [
    { id:'all',       label:'All Emblems' },
    { id:'primitive', label:'Primitive Symbols' },
    { id:'equipment', label:'Equipment Blocks' },
    { id:'optional',  label:'Optional Blocks' },
    { id:'wires',     label:'Wire Types' },
  ];

  const primitiveIds = ['ground','pv-module','inverter-symbol','meter-symbol','knife-switch','fuse','breaker','lug','busbar','callout'];
  const equipmentIds = ['pv-array','roof-jbox','dc-disconnect','ac-combiner','inverter-box','ac-disconnect','msp-load','utility-meter'];
  const optionalIds  = ['battery','bui-enphase','bui-tesla','bui-generic','backup-panel','generator','ats'];

  const filteredEmblems = activeSection === 'all' ? emblems
    : activeSection === 'primitive' ? emblems.filter(e => primitiveIds.includes(e.id))
    : activeSection === 'equipment' ? emblems.filter(e => equipmentIds.includes(e.id))
    : activeSection === 'optional'  ? emblems.filter(e => optionalIds.includes(e.id))
    : [];

  function handleDownloadSVG() {
    const svgStr = buildFullSVG();
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'solarpro-sld-emblems.svg';
    a.click(); URL.revokeObjectURL(url);
  }

  function handleDownloadHTML() {
    // Grab the rendered cards HTML
    const container = document.getElementById('emblem-container');
    if (!container) return;
    const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SolarPro — SLD Emblem Reference</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f1117;color:#e2e8f0;padding:32px;}
h1{font-size:22px;font-weight:700;color:#f8fafc;margin-bottom:4px;}
.sub{font-size:13px;color:#64748b;margin-bottom:28px;}
.grid{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:32px;}
.card{background:#1a1f2e;border:1px solid #2d3748;border-radius:10px;padding:16px;display:flex;flex-direction:column;align-items:center;}
.label{margin-top:10px;font-size:12px;font-weight:600;color:#cbd5e1;text-align:center;}
.cardsub{font-size:10px;color:#64748b;text-align:center;margin-top:3px;}
.badge{display:inline-block;font-size:9px;font-weight:700;padding:2px 8px;border-radius:4px;margin-top:5px;}
.badge-blue{background:#1e3a5f;color:#60a5fa;}
.badge-green{background:#1a2e1a;color:#4ade80;}
.badge-purple{background:#2e1a2e;color:#c084fc;}
.badge-yellow{background:#2e2a1a;color:#fbbf24;}
.sec-title{font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.2px;border-bottom:1px solid #1e293b;padding-bottom:6px;margin:28px 0 14px;}
.wire-row{display:flex;align-items:center;gap:14px;padding:10px 14px;background:#1a1f2e;border:1px solid #2d3748;border-radius:8px;margin-bottom:8px;}
.wire-label{font-size:12px;color:#cbd5e1;font-weight:500;min-width:250px;}
.wire-sub{font-size:10px;color:#64748b;}
</style>
</head>
<body>
<h1>SolarPro — SLD Emblem Reference</h1>
<p class="sub">sld-professional-renderer.ts · IEEE 315 / ANSI Standard</p>
${container.innerHTML}
</body>
</html>`;
    const blob = new Blob([fullHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'solarpro-sld-emblems.html';
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <Layers size={22} className="text-amber-400" />
            SLD Emblem Reference
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            All symbols rendered by <code className="text-amber-400 text-xs bg-amber-500/10 px-1.5 py-0.5 rounded">sld-professional-renderer.ts</code> — IEEE 315 / ANSI standard
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadSVG}
            className="flex items-center gap-2 text-xs bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-all font-semibold"
          >
            <Download size={13} /> Download SVG
          </button>
          <button
            onClick={handleDownloadHTML}
            className="flex items-center gap-2 text-xs bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg transition-all font-semibold"
          >
            <Download size={13} /> Download HTML
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
        <Info size={15} className="text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-slate-300 leading-relaxed">
          These are the <strong className="text-white">exact SVG primitives</strong> used on every generated SLD. 
          Badge colors indicate when each emblem appears: <span className="text-blue-400 font-semibold">Always</span> renders on every diagram, 
          <span className="text-green-400 font-semibold ml-1">String only</span> / <span className="text-purple-400 font-semibold">Micro only</span> are topology-specific, 
          and <span className="text-amber-400 font-semibold ml-1">Optional</span> badges only appear when that equipment is configured.
        </div>
      </div>

      {/* Section filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`text-xs px-4 py-2 rounded-lg font-semibold transition-all ${
              activeSection === s.id
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'text-slate-400 border border-white/10 hover:text-white hover:bg-white/5'
            }`}
          >
            {s.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <span>Zoom:</span>
          {[0.75, 1, 1.25, 1.5].map(z => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`px-2 py-1 rounded transition-all ${zoom === z ? 'bg-white/10 text-white' : 'hover:bg-white/5'}`}
            >
              {Math.round(z * 100)}%
            </button>
          ))}
        </div>
      </div>

      {/* Emblem grid */}
      <div id="emblem-container">
        {activeSection !== 'wires' && (
          <>
            {/* Primitive symbols */}
            {(activeSection === 'all' || activeSection === 'primitive') && (
              <div className="mb-8">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 border-b border-white/5 pb-2">
                  Primitive Symbols (IEEE 315) — building blocks used by all nodes
                </div>
                <div className="flex flex-wrap gap-4">
                  {emblems.filter(e => primitiveIds.includes(e.id)).map(e => (
                    <EmblemCard key={e.id} emblem={e} zoom={zoom} />
                  ))}
                </div>
              </div>
            )}

            {/* Always-rendered equipment */}
            {(activeSection === 'all' || activeSection === 'equipment') && (
              <>
                <div className="mb-8">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 border-b border-white/5 pb-2">
                    Equipment Blocks — Always Rendered
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {emblems.filter(e => ['pv-array','roof-jbox','ac-disconnect','utility-meter'].includes(e.id)).map(e => (
                      <EmblemCard key={e.id} emblem={e} zoom={zoom} />
                    ))}
                  </div>
                </div>
                <div className="mb-8">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 border-b border-white/5 pb-2">
                    Equipment Blocks — String / Optimizer Topology
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {emblems.filter(e => ['dc-disconnect','inverter-box','msp-load'].includes(e.id)).map(e => (
                      <EmblemCard key={e.id} emblem={e} zoom={zoom} />
                    ))}
                  </div>
                </div>
                <div className="mb-8">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 border-b border-white/5 pb-2">
                    Equipment Blocks — Microinverter Topology
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {emblems.filter(e => ['ac-combiner'].includes(e.id)).map(e => (
                      <EmblemCard key={e.id} emblem={e} zoom={zoom} />
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Optional blocks */}
            {(activeSection === 'all' || activeSection === 'optional') && (
              <>
                <div className="mb-8">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 border-b border-white/5 pb-2">
                    Optional Blocks — Battery & Storage System
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {emblems.filter(e => ['battery','bui-enphase','bui-tesla','bui-generic','backup-panel'].includes(e.id)).map(e => (
                      <EmblemCard key={e.id} emblem={e} zoom={zoom} />
                    ))}
                  </div>
                </div>
                <div className="mb-8">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 border-b border-white/5 pb-2">
                    Optional Blocks — Generator & Transfer
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {emblems.filter(e => ['generator','ats'].includes(e.id)).map(e => (
                      <EmblemCard key={e.id} emblem={e} zoom={zoom} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* Wire types */}
        {(activeSection === 'all' || activeSection === 'wires') && (
          <div className="mb-8">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 border-b border-white/5 pb-2">
              Wire / Conductor Types
            </div>
            <div className="flex flex-col gap-3 max-w-2xl">
              {WIRE_TYPES.map(w => (
                <div key={w.id} className="flex items-center gap-5 bg-white/3 border border-white/8 rounded-xl px-5 py-3">
                  <div dangerouslySetInnerHTML={{ __html: wireSVG(w.stroke, w.dash, w.sw) }} />
                  <div>
                    <div className="text-sm font-semibold text-slate-200">{w.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{w.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmblemCard({ emblem, zoom }: { emblem: typeof emblems[0]; zoom: number }) {
  return (
    <div className="bg-white/3 border border-white/8 rounded-xl p-4 flex flex-col items-center gap-3 hover:border-white/20 transition-all">
      <div
        style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', transition: 'transform 0.2s' }}
        dangerouslySetInnerHTML={{ __html: emblem.svg() }}
      />
      <div className="text-center mt-1">
        <div className="text-xs font-semibold text-slate-200">{emblem.label}</div>
        <div className="text-[10px] text-slate-500 mt-1">{emblem.sub}</div>
        <span className={`inline-block text-[9px] font-bold px-2 py-0.5 rounded-full mt-1.5 ${BADGE_STYLES[emblem.badgeColor]}`}>
          {emblem.badge}
        </span>
      </div>
    </div>
  );
}