#!/usr/bin/env python3
"""Replace MountSpacingDiagram with 3-view precision engineering attachment diagram."""

with open('app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

idx_start = content.find('            const MountSpacingDiagram = () => {')
idx_end_marker = '            // Ballast layout SVG (commercial)'
idx_end = content.find(idx_end_marker, idx_start)

if idx_start < 0 or idx_end < 0:
    print(f"Not found: start={idx_start}, end={idx_end}")
    exit(1)

OLD_BLOCK = content[idx_start:idx_end]
print(f"Replacing {len(OLD_BLOCK)} chars")

NEW_DIAGRAM = r'''            const MountSpacingDiagram = () => {
              const [diagramView, setDiagramView] = React.useState<'layout'|'section'|'iso'>('layout');
              const attachSpIn  = compliance.structural?.attachment?.attachmentSpacing ?? compliance.structural?.mountLayout?.mountSpacingIn ?? mountSpacing;
              const railSpIn    = compliance.structural?.attachment?.railSpacing ?? 64;
              const upliftLbs   = compliance.structural?.wind?.upliftPerAttachment ?? upliftPerMount;
              const deadLbs     = compliance.structural?.deadLoad?.deadLoadPerAttachment ?? downwardPerMount;
              const sfactor     = compliance.structural?.attachment?.safetyFactor ?? safetyFactor;
              const lagSpec     = selectedSystem?.mount?.fastenerDiameterIn
                ? `${selectedSystem.mount.fastenerDiameterIn}" \u2300 \u00d7 ${selectedSystem.mount.fastenerEmbedmentIn}" embed`
                : '5/16" \u2300 \u00d7 2.5" embed';
              const mountModel  = selectedSystem?.mount?.model ?? 'L-Foot';
              const railModel   = selectedSystem?.rail?.model ?? 'XR Rail';
              const sfColor     = sfactor >= 2 ? '#10b981' : sfactor >= 1.5 ? '#f59e0b' : '#ef4444';

              const TopDownLayout = () => {
                const SCALE = 0.85;
                const panelLenPx = (compliance.structural?.arrayGeometry?.panelLengthIn ?? 73) * SCALE;
                const panelWidPx = (compliance.structural?.arrayGeometry?.panelWidthIn  ?? 41) * SCALE;
                const attachSpPx = Math.max(30, attachSpIn * SCALE);
                const gapPx = 4;
                const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(totalPanels))));
                const rows = Math.min(3, Math.max(1, Math.ceil(totalPanels / cols)));
                const marginL = 48; const marginT = 28;
                const svgW = marginL + cols * (panelLenPx + gapPx) + 50;
                const svgH = marginT + rows * (panelWidPx + 22) + 60;
                const railY = (r: number) => [
                  marginT + r*(panelWidPx+22) + panelWidPx*0.22,
                  marginT + r*(panelWidPx+22) + panelWidPx*0.78,
                ];
                const mountPts: {x:number;y:number;rail:number}[] = [];
                for (let r=0;r<rows;r++) {
                  const [y1,y2]=railY(r);
                  const rowW = cols*(panelLenPx+gapPx)-gapPx;
                  const nM = Math.max(2, Math.round(rowW/attachSpPx)+1);
                  const step = rowW/Math.max(1,nM-1);
                  for (let m=0;m<nM;m++) {
                    mountPts.push({x:marginL+m*step,y:y1,rail:0});
                    mountPts.push({x:marginL+m*step,y:y2,rail:1});
                  }
                }
                return (
                  <svg width="100%" viewBox={`0 0 ${svgW} ${svgH}`} style={{maxHeight:280}}>
                    <defs>
                      <marker id="da-r" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L0,5 L5,2.5 z" fill="#64748b"/></marker>
                      <marker id="da-l" markerWidth="5" markerHeight="5" refX="1" refY="2.5" orient="auto"><path d="M5,0 L5,5 L0,2.5 z" fill="#64748b"/></marker>
                      <pattern id="pnl-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="8" stroke="#1e40af" strokeWidth="1" opacity="0.25"/>
                      </pattern>
                    </defs>
                    <text x={svgW/2} y={11} textAnchor="middle" fill="#94a3b8" fontSize="8" fontWeight="bold" fontFamily="monospace">
                      TOP-DOWN ARRAY LAYOUT — {cols}x{rows} ({totalPanels} MODULES)
                    </text>
                    {Array.from({length:rows}).map((_,r)=>{
                      const [y1,y2]=railY(r);
                      const x1=marginL-12; const x2=marginL+cols*(panelLenPx+gapPx)+8;
                      return (<g key={`rl-${r}`}>
                        <line x1={x1} y1={y1} x2={x2} y2={y1} stroke="#f59e0b" strokeWidth="3" strokeLinecap="round"/>
                        <line x1={x1} y1={y2} x2={x2} y2={y2} stroke="#f59e0b" strokeWidth="3" strokeLinecap="round"/>
                        <text x={x1-3} y={y1+3} textAnchor="end" fill="#f59e0b" fontSize="7" fontFamily="monospace">R{r*2+1}</text>
                        <text x={x1-3} y={y2+3} textAnchor="end" fill="#f59e0b" fontSize="7" fontFamily="monospace">R{r*2+2}</text>
                      </g>);
                    })}
                    {Array.from({length:rows}).map((_,r)=>Array.from({length:cols}).map((_,c)=>{
                      const px=marginL+c*(panelLenPx+gapPx); const py=marginT+r*(panelWidPx+22);
                      return (<g key={`pnl-${r}-${c}`}>
                        <rect x={px} y={py} width={panelLenPx} height={panelWidPx} fill="#0f172a" stroke="#334155" strokeWidth="1" rx="1"/>
                        <rect x={px+2} y={py+2} width={panelLenPx-4} height={panelWidPx-4} fill="url(#pnl-hatch)" rx="1"/>
                        {[1,2,3].map(cl=>(
                          <line key={cl} x1={px+(panelLenPx/4)*cl} y1={py+2} x2={px+(panelLenPx/4)*cl} y2={py+panelWidPx-2} stroke="#1e3a5f" strokeWidth="0.5"/>
                        ))}
                      </g>);
                    }))}
                    {mountPts.map((m,i)=>(
                      <g key={`mpt-${i}`}>
                        <circle cx={m.x} cy={m.y} r={4.5} fill="#ef4444" stroke="#fca5a5" strokeWidth="1.5"/>
                        <circle cx={m.x} cy={m.y} r={1.5} fill="white"/>
                      </g>
                    ))}
                    {(()=>{
                      const p0=mountPts.filter(m=>m.rail===0);
                      if(p0.length<2)return null;
                      const dy=svgH-24;
                      return (<g>
                        <line x1={p0[0].x} y1={dy} x2={p0[1].x} y2={dy} stroke="#64748b" strokeWidth="1" markerStart="url(#da-l)" markerEnd="url(#da-r)"/>
                        <line x1={p0[0].x} y1={dy-5} x2={p0[0].x} y2={dy+5} stroke="#64748b" strokeWidth="0.8"/>
                        <line x1={p0[1].x} y1={dy-5} x2={p0[1].x} y2={dy+5} stroke="#64748b" strokeWidth="0.8"/>
                        <rect x={(p0[0].x+p0[1].x)/2-20} y={dy-8} width={40} height={10} fill="#0f172a"/>
                        <text x={(p0[0].x+p0[1].x)/2} y={dy} textAnchor="middle" fill="#94a3b8" fontSize="7.5" fontFamily="monospace">{attachSpIn}" O.C.</text>
                      </g>);
                    })()}
                    {rows>=1&&(()=>{
                      const [y1,y2]=railY(0); const dx=svgW-12;
                      return (<g>
                        <line x1={dx} y1={y1} x2={dx} y2={y2} stroke="#f59e0b" strokeWidth="1" markerStart="url(#da-l)" markerEnd="url(#da-r)"/>
                        <text x={dx+5} y={(y1+y2)/2+3} textAnchor="start" fill="#f59e0b" fontSize="7" fontFamily="monospace">{railSpIn}"</text>
                      </g>);
                    })()}
                    <g transform={`translate(${marginL},${svgH-12})`}>
                      <rect x={0} y={0} width={9} height={7} fill="#0f172a" stroke="#334155" rx="1"/>
                      <text x={13} y={7} fill="#64748b" fontSize="7" fontFamily="monospace">Panel</text>
                      <line x1={50} y1={3} x2={62} y2={3} stroke="#f59e0b" strokeWidth="2.5"/>
                      <text x={66} y={7} fill="#64748b" fontSize="7" fontFamily="monospace">Rail</text>
                      <circle cx={104} cy={3} r={4} fill="#ef4444" stroke="#fca5a5" strokeWidth="1"/>
                      <text x={112} y={7} fill="#64748b" fontSize="7" fontFamily="monospace">L-Foot</text>
                    </g>
                  </svg>
                );
              };

              const CrossSectionView = () => {
                const W=480; const H=285;
                const groundY=H-16; const rafterH=128; const rafterTop=groundY-rafterH;
                const sheathT=rafterTop-13; const underT=sheathT-4; const shingleT=underT-11;
                const lFBase=shingleT-2; const lFTop=lFBase-28;
                const railBase=lFTop-2; const railTop=railBase-15;
                const pBase=railTop; const pTop=pBase-26;
                const RW=38; const RG=90;
                const rafters=[38,38+RG,38+RG*2,38+RG*3];
                const arrayW=rafters[rafters.length-1]+RW-rafters[0];
                return (
                  <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{maxHeight:285}}>
                    <defs>
                      <linearGradient id="pnlG" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#1e40af" stopOpacity="0.95"/><stop offset="100%" stopColor="#0f172a"/>
                      </linearGradient>
                      <linearGradient id="rfG" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#92400e"/><stop offset="100%" stopColor="#78350f"/>
                      </linearGradient>
                      <pattern id="shn" patternUnits="userSpaceOnUse" width="18" height="11">
                        <rect width="18" height="11" fill="#374151"/>
                        <line x1="0" y1="5" x2="18" y2="5" stroke="#4b5563" strokeWidth="0.5"/>
                        <line x1="9" y1="0" x2="9" y2="5" stroke="#4b5563" strokeWidth="0.5"/>
                      </pattern>
                      <marker id="sa-r" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L0,5 L5,2.5 z" fill="#64748b"/></marker>
                      <marker id="sa-l" markerWidth="5" markerHeight="5" refX="1" refY="2.5" orient="auto"><path d="M5,0 L5,5 L0,2.5 z" fill="#64748b"/></marker>
                      <marker id="up-a" markerWidth="7" markerHeight="7" refX="3.5" refY="6" orient="auto"><path d="M0,7 L3.5,0 L7,7 z" fill="#ef4444"/></marker>
                      <marker id="dn-a" markerWidth="7" markerHeight="7" refX="3.5" refY="1" orient="auto"><path d="M0,0 L3.5,7 L7,0 z" fill="#3b82f6"/></marker>
                    </defs>
                    <text x={W/2} y={10} textAnchor="middle" fill="#94a3b8" fontSize="7.5" fontWeight="bold" fontFamily="monospace">
                      CROSS-SECTION DETAIL — ROOF ATTACHMENT (NDS 2018 / ICC-ES AC428)
                    </text>
                    {rafters.map((rx,i)=>(
                      <g key={`rf-${i}`}>
                        <rect x={rx} y={rafterTop} width={RW} height={rafterH} fill="url(#rfG)" stroke="#92400e" strokeWidth="1"/>
                        {i===1&&<text x={rx+RW/2} y={rafterTop+55} textAnchor="middle" fill="#fbbf24" fontSize="6.5" fontFamily="monospace" transform={`rotate(-90,${rx+RW/2},${rafterTop+55})`}>{config.rafterSize??'2x6'} RAFTER</text>}
                      </g>
                    ))}
                    <line x1={rafters[0]+RW/2} y1={groundY+5} x2={rafters[1]+RW/2} y2={groundY+5} stroke="#64748b" strokeWidth="0.8" markerStart="url(#sa-l)" markerEnd="url(#sa-r)"/>
                    <rect x={(rafters[0]+rafters[1]+RW)/2-16} y={groundY+1} width={32} height={9} fill="#0f172a"/>
                    <text x={(rafters[0]+rafters[1]+RW)/2} y={groundY+8} textAnchor="middle" fill="#94a3b8" fontSize="7" fontFamily="monospace">{config.rafterSpacing??24}"OC</text>
                    <rect x={rafters[0]} y={sheathT} width={arrayW} height={rafterTop-sheathT} fill="#44403c" stroke="#57534e" strokeWidth="0.5"/>
                    <text x={rafters[0]-4} y={sheathT+9} textAnchor="end" fill="#78716c" fontSize="6.5" fontFamily="monospace">7/16"OSB</text>
                    <rect x={rafters[0]} y={underT} width={arrayW} height={sheathT-underT} fill="#1c1917" stroke="#292524" strokeWidth="0.5"/>
                    <rect x={rafters[0]} y={shingleT} width={arrayW} height={underT-shingleT} fill="url(#shn)" stroke="#4b5563" strokeWidth="0.5"/>
                    <text x={rafters[0]-4} y={shingleT+7} textAnchor="end" fill="#94a3b8" fontSize="6.5" fontFamily="monospace">SHINGLES</text>
                    {(()=>{
                      const lx=rafters[1]+RW/2-7;
                      return (<g>
                        <rect x={lx} y={lFTop} width={14} height={lFBase-lFTop} fill="#6b7280" stroke="#9ca3af" strokeWidth="1"/>
                        <rect x={lx-6} y={lFBase-8} width={26} height={10} fill="#6b7280" stroke="#9ca3af" strokeWidth="1"/>
                        <line x1={lx+7} y1={lFBase} x2={lx+7} y2={lFBase+52} stroke="#fbbf24" strokeWidth="3" strokeDasharray="5,3"/>
                        <circle cx={lx+7} cy={lFBase-4} r={4} fill="#fbbf24"/>
                        <rect x={lx-10} y={shingleT-3} width={34} height={5} fill="#9ca3af" opacity="0.7"/>
                        <line x1={lx+18} y1={lFTop+8} x2={lx+46} y2={lFTop+1} stroke="#94a3b8" strokeWidth="0.8"/>
                        <text x={lx+48} y={lFTop+2} fill="#e2e8f0" fontSize="7" fontFamily="monospace">{mountModel}</text>
                        <line x1={lx+16} y1={lFBase+32} x2={lx+40} y2={lFBase+24} stroke="#fbbf24" strokeWidth="0.8"/>
                        <text x={lx+42} y={lFBase+25} fill="#fbbf24" fontSize="6.5" fontFamily="monospace">{lagSpec}</text>
                      </g>);
                    })()}
                    <rect x={rafters[0]+8} y={railTop} width={arrayW-16} height={railBase-railTop} fill="#78716c" stroke="#a8a29e" strokeWidth="1" rx="2"/>
                    <text x={rafters[0]+8} y={railTop-3} fill="#f59e0b" fontSize="7" fontFamily="monospace">{railModel} RAIL</text>
                    <rect x={rafters[0]+16} y={pTop} width={arrayW-32} height={pBase-pTop} fill="url(#pnlG)" stroke="#3b82f6" strokeWidth="1.5" rx="2"/>
                    <text x={rafters[0]+arrayW/2} y={pTop+(pBase-pTop)/2+3} textAnchor="middle" fill="#93c5fd" fontSize="7.5" fontFamily="monospace" fontWeight="bold">PV MODULE</text>
                    {upliftLbs>0&&(<g>
                      <line x1={rafters[0]+55} y1={pTop+14} x2={rafters[0]+55} y2={pTop-8} stroke="#ef4444" strokeWidth="2.5" markerEnd="url(#up-a)"/>
                      <rect x={rafters[0]+36} y={pTop-22} width={38} height={12} fill="#7f1d1d" rx="2"/>
                      <text x={rafters[0]+55} y={pTop-12} textAnchor="middle" fill="#fca5a5" fontSize="6.5" fontFamily="monospace">UP {upliftLbs.toFixed(0)}lbs</text>
                    </g>)}
                    {deadLbs>0&&(<g>
                      <line x1={rafters[0]+100} y1={pTop-8} x2={rafters[0]+100} y2={pTop+14} stroke="#3b82f6" strokeWidth="2.5" markerEnd="url(#dn-a)"/>
                      <rect x={rafters[0]+80} y={pTop-22} width={38} height={12} fill="#1e3a8a" rx="2"/>
                      <text x={rafters[0]+99} y={pTop-12} textAnchor="middle" fill="#93c5fd" fontSize="6.5" fontFamily="monospace">DL {deadLbs.toFixed(0)}lbs</text>
                    </g>)}
                    <rect x={W-84} y={18} width={76} height={38} rx="4" fill="#0f172a" stroke={sfColor} strokeWidth="1.5"/>
                    <text x={W-46} y={36} textAnchor="middle" fill={sfColor} fontSize="16" fontWeight="bold" fontFamily="monospace">{sfactor>0?sfactor.toFixed(2):'—'}</text>
                    <text x={W-46} y={48} textAnchor="middle" fill="#64748b" fontSize="7" fontFamily="monospace">SAFETY FACTOR</text>
                    <text x={6} y={pTop+(pBase-pTop)/2+3} fill="#3b82f6" fontSize="6.5" fontFamily="monospace">MODULE</text>
                    <text x={6} y={railTop+(railBase-railTop)/2+3} fill="#f59e0b" fontSize="6.5" fontFamily="monospace">RAIL</text>
                    <text x={6} y={shingleT+7} fill="#94a3b8" fontSize="6.5" fontFamily="monospace">SHINGLE</text>
                    <text x={6} y={sheathT+9} fill="#a87f60" fontSize="6.5" fontFamily="monospace">SHEATH</text>
                    <text x={6} y={rafterTop+16} fill="#d97706" fontSize="6.5" fontFamily="monospace">RAFTER</text>
                  </svg>
                );
              };

              const IsoView = () => {
                const W=480; const H=255;
                const iso=(x:number,y:number,z:number):[number,number]=>[
                  W/2+(x-y)*0.866*0.82, H/2+(x+y)*0.5*0.82-z*0.82
                ];
                const panelW=95; const panelH=55; const gap2=6;
                const cols2=Math.min(3,Math.max(1,Math.ceil(Math.sqrt(totalPanels/2))));
                const rows2=Math.min(2,Math.max(1,Math.ceil(totalPanels/cols2/2)));
                const tR=(config.roofPitch??20)*Math.PI/180;
                const sinT=Math.sin(tR)*0.55;
                return (
                  <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{maxHeight:255}}>
                    <defs>
                      <linearGradient id="isoP" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#1e40af" stopOpacity="0.95"/><stop offset="100%" stopColor="#0f172a"/>
                      </linearGradient>
                      <linearGradient id="isoR" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#374151"/><stop offset="100%" stopColor="#1f2937"/>
                      </linearGradient>
                    </defs>
                    <text x={W/2} y={11} textAnchor="middle" fill="#94a3b8" fontSize="8" fontWeight="bold" fontFamily="monospace">
                      ISOMETRIC VIEW — {config.roofPitch??20}deg PITCH
                    </text>
                    {(()=>{
                      const p=[iso(-22,-22,0),iso(cols2*(panelW+gap2)+32,-22,0),
                        iso(cols2*(panelW+gap2)+32,rows2*(panelH+gap2)+22,sinT*(rows2*(panelH+gap2)+22)),
                        iso(-22,rows2*(panelH+gap2)+22,sinT*(rows2*(panelH+gap2)+22))];
                      return <polygon points={p.map(q=>q.join(',')).join(' ')} fill="url(#isoR)" stroke="#4b5563" strokeWidth="1" opacity="0.85"/>;
                    })()}
                    {Array.from({length:rows2+1}).map((_,r)=>{
                      const ry=r*(panelH+gap2)+panelH*0.28;
                      const p1=iso(-10,ry,sinT*ry+9); const p2=iso(cols2*(panelW+gap2)+10,ry,sinT*ry+9);
                      return <line key={r} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke="#f59e0b" strokeWidth="3" strokeLinecap="round"/>;
                    })}
                    {Array.from({length:rows2}).map((_,r)=>Array.from({length:cols2}).map((_,c)=>{
                      const px=c*(panelW+gap2); const py=r*(panelH+gap2); const pz=sinT*py+8;
                      const pts=[iso(px,py,pz),iso(px+panelW,py,pz),iso(px+panelW,py+panelH,pz+sinT*panelH),iso(px,py+panelH,pz+sinT*panelH)];
                      return (<g key={`ip-${r}-${c}`}>
                        <polygon points={pts.map(q=>q.join(',')).join(' ')} fill="url(#isoP)" stroke="#3b82f6" strokeWidth="1.2"/>
                        {[1,2,3].map(cl=>{
                          const l1=iso(px+panelW*cl/4,py,pz); const l2=iso(px+panelW*cl/4,py+panelH,pz+sinT*panelH);
                          return <line key={cl} x1={l1[0]} y1={l1[1]} x2={l2[0]} y2={l2[1]} stroke="#1e3a8a" strokeWidth="0.6"/>;
                        })}
                      </g>);
                    }))}
                    {Array.from({length:rows2+1}).map((_,r)=>Array.from({length:Math.max(2,cols2)}).map((_,m)=>{
                      const ry=r*(panelH+gap2)+panelH*0.28; const mx=m*(panelW+gap2);
                      const [cx,cy]=iso(mx,ry,sinT*ry+11);
                      return <circle key={`im-${r}-${m}`} cx={cx} cy={cy} r={5} fill="#ef4444" stroke="#fca5a5" strokeWidth="1.5"/>;
                    }))}
                    <rect x={W-88} y={H-44} width={80} height={36} rx="4" fill="#0f172a" stroke="#334155" strokeWidth="1"/>
                    <text x={W-48} y={H-26} textAnchor="middle" fill="#f59e0b" fontSize="14" fontWeight="bold" fontFamily="monospace">{config.roofPitch??20}deg</text>
                    <text x={W-48} y={H-13} textAnchor="middle" fill="#64748b" fontSize="7" fontFamily="monospace">ROOF PITCH</text>
                  </svg>
                );
              };

              return (
                <div>
                  <div className="flex gap-1 mb-2">
                    {([{id:'layout' as const,label:'\u229e Array Layout'},{id:'section' as const,label:'\u22a5 Cross-Section'},{id:'iso' as const,label:'\u2B21 Isometric'}] as const).map(v=>(
                      <button key={v.id} onClick={()=>setDiagramView(v.id)}
                        className={`text-xs px-2.5 py-1 rounded-md font-bold transition-all border ${diagramView===v.id?'bg-amber-500/20 border-amber-500/60 text-amber-300':'border-slate-700/50 text-slate-400 hover:text-slate-300 hover:border-slate-600'}`}>
                        {v.label}
                      </button>
                    ))}
                  </div>
                  <div className="bg-slate-950 rounded-xl p-2 border border-slate-800">
                    {diagramView==='layout'  && <TopDownLayout />}
                    {diagramView==='section' && <CrossSectionView />}
                    {diagramView==='iso'     && <IsoView />}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1.5 text-xs">
                    <div className="bg-slate-900/60 rounded-lg px-2 py-1.5">
                      <div className="text-slate-500">Attach Spacing</div>
                      <div className="text-amber-300 font-bold font-mono">{attachSpIn}" O.C.</div>
                    </div>
                    <div className="bg-slate-900/60 rounded-lg px-2 py-1.5">
                      <div className="text-slate-500">Lag Bolt Spec</div>
                      <div className="text-white font-bold font-mono text-xs">{lagSpec}</div>
                    </div>
                    <div className="bg-slate-900/60 rounded-lg px-2 py-1.5">
                      <div className="text-slate-500">Safety Factor</div>
                      <div className="font-bold font-mono" style={{color:sfColor}}>{sfactor>0?sfactor.toFixed(2):'—'}</div>
                    </div>
                  </div>
                </div>
              );
            };

            // Ballast layout SVG (commercial)'''

content = content[:idx_start] + NEW_DIAGRAM + content[idx_end:]

with open('app/engineering/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Replaced {len(OLD_BLOCK)} chars with {len(NEW_DIAGRAM)} chars")
print("Done!")