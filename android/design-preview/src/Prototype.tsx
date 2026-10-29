import { useEffect, useRef, useState, type ReactNode } from 'react';

import { createPortal } from 'react-dom';

import * as Icons from '@radix-ui/react-icons';

import { DashboardIcon, CheckboxIcon, FileTextIcon, EnvelopeClosedIcon, DotsHorizontalIcon, ReloadIcon, GearIcon, ReaderIcon, BarChartIcon, Pencil1Icon, ArrowTopRightIcon, StarIcon, PersonIcon } from '@radix-ui/react-icons';

import { MobileScroll, Carousel, BottomSheet, KeyboardInput, KeyboardTextarea, useMobileDevice, useKeyboard } from './mobile';



const nav=[['Dashboard','Home',DashboardIcon],['Daily tasks','Tasks',CheckboxIcon],['Applications','Apply',FileTextIcon],['Active clients','Clients',PersonIcon],['Email inbox','Inbox',EnvelopeClosedIcon],['More','More',DotsHorizontalIcon]] as const;

const applications=[['Brightside Co.','Virtual assistant · Interview'],['Oak & Co.','Executive assistant · Applied'],['Studio Twenty','Content assistant · To Proceed'],['Bluebird Digital','Marketing assistant · Ongoing']];

const clients=[['Northstar Studio','Social media assistant · Active'],['Maple Creative','Graphic designer · Active']];

const stories=[{title:'A practical guide to a more organized remote workspace',source:'Sample industry story',description:'Explore tools and routines that help virtual assistants keep client work moving.',image:'https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=900&auto=format&fit=crop&q=80'}, {title:'Making more time for meaningful client work',source:'Sample automation story',description:'Simple workflow ideas for repeat tasks, content planning and a calmer workday.',image:'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=900&auto=format&fit=crop&q=80'}];

function Panel({children}:{children:ReactNode}){return <section className="jv-card">{children}</section>}

function ClientAvatar({name,large=false}:{name:string;large?:boolean}){

  const [failed,setFailed]=useState(false);const parts=name.trim().split(/\s+/);const initials=(parts.length>1?parts[0][0]+parts[parts.length-1][0]:name.slice(0,2)).toUpperCase();

  return <span className={`jv-avatar ${large?'large':''}`}><span aria-hidden="true">{initials}</span>{name==='Northstar Studio'&&!failed&&<img src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=160&h=160&auto=format&fit=crop&crop=faces&q=85" alt={`${name} sample profile photo`} onError={()=>setFailed(true)}/>}</span>

}

function Tabs({options,value,onChange}:{options:string[];value:string;onChange:(v:string)=>void}){return <Carousel ariaLabel="Section tabs" className="jv-tabs" contentClassName="jv-tabs-track">{options.map(v=><button key={v} className={value===v?'selected':''} onClick={()=>onChange(v)}>{v}</button>)}</Carousel>}

function Chart({values,labels,donut=false}:{values:number[];labels:string[];donut?:boolean}){

  const ref=useRef<HTMLCanvasElement>(null);

  useEffect(()=>{const el=ref.current;if(!el)return;const w=el.clientWidth,h=donut?176:180,d=devicePixelRatio||1;el.width=w*d;el.height=h*d;const c=el.getContext('2d')!;c.scale(d,d);c.font='10px Roboto';const colors=['#6366f1','#22b8a8','#f4b860','#ef7992','#94a3b8','#8b5cf6'];const ink=el.closest('.dark')?'#fff':'#475569',grid=el.closest('.dark')?'#343946':'#e5e9f2';

    if(donut){const r=Math.min(w*.23,62),x=r+8,y=h/2,total=values.reduce((a,b)=>a+b,0);c.lineWidth=17;c.strokeStyle=grid;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.stroke();let angle=-Math.PI/2;values.forEach((v,i)=>{const sweep=v/total*Math.PI*2;if(v){c.strokeStyle=colors[i];c.beginPath();c.arc(x,y,r,angle,angle+Math.max(0,sweep-.052));c.stroke()}angle+=sweep});c.fillStyle=ink;c.textAlign='center';c.font='24px Roboto';c.fillText(String(total),x,y+5);c.font='10px Roboto';c.fillText('applications',x,y+23);c.textAlign='left';labels.forEach((l,i)=>{const lx=r*2+28,ly=y-(labels.length-1)*12+i*24;c.fillStyle=colors[i];c.beginPath();c.arc(lx,ly-3,3,0,Math.PI*2);c.fill();c.fillStyle=ink;c.fillText(`${l}  ${values[i]}`,lx+10,ly)})}

    else{const left=25,right=w-8,bottom=h-25,step=(right-left)/values.length,max=Math.max(1,...values);c.strokeStyle=grid;for(let i=0;i<=3;i++){const y=20+(bottom-20)*i/3;c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke()}values.forEach((v,i)=>{const x=left+step*i+step*.2,height=v/max*(bottom-34);c.fillStyle=colors[0];c.beginPath();c.roundRect(x,bottom-Math.max(2,height),step*.6,Math.max(2,height),5);c.fill();c.fillStyle=ink;c.textAlign='center';c.fillText(labels[i],x+step*.3,h-7);c.fillText(String(v),x+step*.3,bottom-height-7)})}

  },[values,labels,donut]);return <canvas ref={ref} className="jv-chart" style={{height:donut?176:180}} role="img" aria-label={labels.map((l,i)=>`${l}: ${values[i]}`).join(', ')}/>

}



type Entry={id:string;title:string;subtitle:string;date:string;status:string;body?:string;amount?:number;url?:string};

const pageIcons:Record<string,typeof Icons.DashboardIcon>={Dashboard:Icons.DashboardIcon,'Daily tasks':Icons.CheckboxIcon,Applications:Icons.FileTextIcon,'Active clients':Icons.PersonIcon,'Email inbox':Icons.EnvelopeClosedIcon,'To apply':Icons.CalendarIcon,Wallet:Icons.CardStackIcon,Subscriptions:Icons.UpdateIcon,Documents:Icons.FileIcon,Invoices:Icons.ReaderIcon,'Industry news':Icons.ReaderIcon,Assistant:Icons.MagicWandIcon,'Weekly report':Icons.BarChartIcon,Scripts:Icons.TextAlignLeftIcon,'Softcopy links':Icons.Link2Icon,Templates:Icons.CopyIcon,Salary:Icons.TableIcon,'Cover letter':Icons.Pencil2Icon,Account:Icons.IdCardIcon,Settings:Icons.GearIcon,More:Icons.DotsHorizontalIcon};

const moreGroups=[{title:'Workspace',pages:['To apply','Industry news','Assistant','Weekly report']},{title:'Finance',pages:['Wallet','Subscriptions','Invoices','Salary']},{title:'Documents & writing',pages:['Cover letter','Scripts','Softcopy links','Documents','Templates']},{title:'Your account',pages:['Account','Settings']}];

const descriptions:Record<string,string>={'To apply':'Opportunities and reminders','Industry news':'Latest stories and industry updates',Assistant:'Research and practical answers','Weekly report':'Applications, completed work and hours',Wallet:'Balances and transactions',Subscriptions:'Paid accounts and renewal dates',Invoices:'Invoices and payment records',Salary:'Calculate your monthly equivalent','Cover letter':'Write and share a local letter draft',Scripts:'Reusable text for your work','Softcopy links':'Google Docs, Sheets and work links',Documents:'Your personal and client files',Templates:'Saved email templates',Account:'Profile, sign-in and connections',Settings:'Appearance, notifications and app settings'};

function AppIcon({page,size=20}:{page:string;size?:number}){const Component=pageIcons[page]??Icons.FileTextIcon;return <Component width={size} height={size} aria-hidden="true"/>}

function Badge({value}:{value:string}){return <span className={'m-badge '+(/active|completed|paid|income/i.test(value)&&!value.includes('Unpaid')?'good':/overdue|expired|unpaid|payable/i.test(value)?'warning':'neutral')}>{value}</span>}

const baseEntries:Record<string,Entry[]>={

 Applications:applications.map((a,i)=>({id:'app'+i,title:a[0],subtitle:a[1].split(' · ')[0],status:a[1].split(' · ')[1],date:`2026-10-${29-i}`})),

 'Active clients':clients.map((a,i)=>({id:'client'+i,title:a[0],subtitle:a[1].split(' · ')[0],status:'Active',date:'2026-10-29'})),

 'To apply':[{id:'rem1',title:'Apply to Pine & Co.',subtitle:'Executive assistant · Remote',status:'Due today',date:'2026-10-29'},{id:'rem2',title:'Research content assistant role',subtitle:'Save the job link and prepare a draft',status:'Upcoming',date:'2026-10-30'}],

 Wallet:[{id:'pay1',title:'Client payment',subtitle:'Wise · Northstar Studio',status:'Income',date:'2026-10-29',amount:12500},{id:'pay2',title:'Design subscription',subtitle:'GCash · Monthly workspace',status:'Expense',date:'2026-10-28',amount:650},{id:'pay3',title:'Internet bill',subtitle:'Due this week · GCash',status:'Payable',date:'2026-10-31',amount:1500}],

 Subscriptions:[{id:'sub1',title:'Design workspace',subtitle:'Personal account',status:'Active',date:'2026-11-15'},{id:'sub2',title:'Cloud storage',subtitle:'Work account',status:'Expired',date:'2026-10-25'}],

 Documents:[{id:'doc1',title:'Jeff VA resume.pdf',subtitle:'PDF · 240 KB',status:'Personal',date:'2026-10-20'},{id:'doc2',title:'Content brief.docx',subtitle:'Word document · Northstar Studio',status:'Client',date:'2026-10-28'}],

 Invoices:[{id:'inv1',title:'Invoice JV-0012',subtitle:'Northstar Studio · USD 1,200',status:'Unpaid',date:'2026-10-31'},{id:'inv2',title:'Invoice JV-0011',subtitle:'Maple Creative · USD 500',status:'Paid',date:'2026-10-20'}],

 Scripts:[{id:'scr1',title:'Weekly client check-in',subtitle:'Client communication',status:'Script',date:'2026-10-26',body:'Hi! Here is a quick update on this week’s completed work, upcoming priorities and anything I need your input on.'}],

 'Softcopy links':[{id:'link1',title:'Content planning sheet',subtitle:'Google Sheets · Client resources',status:'Link',date:'2026-10-28',url:'https://docs.google.com/'},{id:'link2',title:'Project brief',subtitle:'Google Docs · Working files',status:'Link',date:'2026-10-25',url:'https://docs.google.com/'}],

 Templates:[{id:'tpl1',title:'Project introduction',subtitle:'Welcome email',status:'Template',date:'2026-10-22',body:'Hi, thank you for sharing the project details. I’m looking forward to working together. Here are the next steps.'}]

};

const initialTasks=[{id:'t1',title:'Prepare weekly content schedule',client:'Northstar Studio',date:'2026-10-29',done:false,created:'2026-10-28'},{id:'t2',title:'Review draft captions',client:'Maple Creative',date:'2026-10-28',done:false,created:'2026-10-27'},{id:'t3',title:'Send weekly progress report',client:'Northstar Studio',date:'2026-10-30',done:false,created:'2026-10-29'},{id:'t4',title:'Organize brand files',client:'Maple Creative',date:'2026-10-27',done:true,created:'2026-10-26'}];

export default function Prototype(){

 const {setDeviceId}=useMobileDevice(),keyboard=useKeyboard();

 const [page,setPage]=useState(()=>{const route=new URLSearchParams(location.search).get('screen')??'Dashboard';return pageIcons[route]?route:'Dashboard'});

 const [client,setClient]=useState(false),[tab,setTab]=useState('To do'),[order,setOrder]=useState(['Daily tasks','To apply','Subscriptions'].includes(page)?'Due date':'Newest'),[status,setStatus]=useState('All'),[query,setQuery]=useState('');

 const [entries,setEntries]=useState(baseEntries),[taskRows,setTaskRows]=useState(initialTasks),[sheet,setSheet]=useState(''),[selected,setSelected]=useState<Entry|null>(null),[selectedTask,setSelectedTask]=useState('t1'),[notice,setNotice]=useState('');

 const [folder,setFolder]=useState('Inbox'),[topic,setTopic]=useState('All news'),[dark,setDark]=useState(false),[notifications,setNotifications]=useState(false),[notifyTasks,setNotifyTasks]=useState(true),[notifyRenewals,setNotifyRenewals]=useState(true);

 const [mail,setMail]=useState([
 {id:'mail1',from:'Alex Rivera <alex@example.com>',to:'jeff@example.com',title:'Content plan for next week',body:'Let us review the content schedule tomorrow. Please bring the updated draft captions.',date:'Oct 30',sent:false,star:false,read:false,archived:false},
 {id:'mail2',from:'Brightside hiring team <hiring@example.com>',to:'jeff@example.com',title:'Your interview invitation',body:'Thank you for your application. We would love to learn more about your experience.',date:'Oct 30',sent:false,star:true,read:false,archived:false},
 {id:'mail3',from:'Maple Creative <studio@example.com>',to:'jeff@example.com',title:'October design files',body:'The final assets are ready. You can find the updated files in the shared folder.',date:'Oct 29',sent:false,star:false,read:true,archived:false},
 {id:'mail4',from:'Jordan Lee <jordan@example.com>',to:'jeff@example.com',title:'A quick update before our weekly check-in',body:'Here are the last few notes for the client presentation. Let me know what you think.',date:'Oct 29',sent:false,star:false,read:false,archived:false},
 {id:'mail5',from:'Northstar Studio <team@example.com>',to:'jeff@example.com',title:'Re: Weekly progress report',body:'Everything looks good. Thanks for keeping the project moving this week.',date:'Oct 28',sent:false,star:true,read:true,archived:false},
 {id:'mail6',from:'Jeff VA <jeff@example.com>',to:'Alex Rivera <alex@example.com>',title:'Weekly progress report',body:'Here is the summary of completed work and next steps for this week.',date:'Oct 28',sent:true,star:false,read:true,archived:false},
 {id:'mail7',from:'Workspace updates <updates@example.com>',to:'jeff@example.com',title:'Your workspace summary',body:'A look back at this month and the work you completed.',date:'Oct 27',sent:false,star:false,read:true,archived:true}
 ]);

 const [editingEntry,setEditingEntry]=useState(false);
 const [formValues,setFormValues]=useState<Record<string,string>>({});
 const [fieldTitle,setFieldTitle]=useState(''),[returnSheet,setReturnSheet]=useState(''),[fieldOptions,setFieldOptions]=useState<string[]>([]);const fieldSetter=useRef<(value:string)=>void>(()=>{});

 const [mailId,setMailId]=useState('mail1'),[recipient,setRecipient]=useState(''),[subject,setSubject]=useState(''),[copy,setCopy]=useState(''),[itemName,setItemName]=useState(''),[itemDetail,setItemDetail]=useState(''),[itemDate,setItemDate]=useState('2026-10-29');

 const [rate,setRate]=useState('10'),[hours,setHours]=useState('40'),[payType,setPayType]=useState('Hourly'),[currency,setCurrency]=useState('USD'),[letterName,setLetterName]=useState('Hiring Manager'),[letterCompany,setLetterCompany]=useState(''),[letterRole,setLetterRole]=useState(''),[letterBody,setLetterBody]=useState('');

 const scrollHost=useRef<HTMLDivElement>(null),armed=useRef(false),wheelAmount=useRef(0),wheelTime=useRef(0),refreshTimer=useRef<ReturnType<typeof setTimeout>|null>(null),refreshingRef=useRef(false);

 const [pull,setPull]=useState(0),[refreshing,setRefreshing]=useState(false);

 const currentMail=mail.find(m=>m.id===mailId)!,currentTask=taskRows.find(t=>t.id===selectedTask);

 useEffect(()=>{setDeviceId('pixel-10');document.title='Jeff VA · Modern Android preview'},[setDeviceId]);

 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),3200);return()=>clearTimeout(t)},[notice]);

 const refresh=()=>{if(refreshingRef.current)return;refreshingRef.current=true;setRefreshing(true);setPull(0);armed.current=false;wheelAmount.current=0;refreshTimer.current=setTimeout(()=>{refreshingRef.current=false;setRefreshing(false);setNotice('Updated · sample data')},1500)};

 useEffect(()=>{refreshingRef.current=false;setRefreshing(false);setPull(0);armed.current=false;wheelAmount.current=0;if(refreshTimer.current)clearTimeout(refreshTimer.current);const scroll=scrollHost.current?.querySelector<HTMLElement>('.mobile-scroll');if(!scroll)return;const observer=new MutationObserver(()=>{if(refreshingRef.current)return;const amount=Math.max(0,Number(scroll.dataset.overscroll)||0);setPull(amount);armed.current=amount>=42});observer.observe(scroll,{attributes:true,attributeFilter:['data-overscroll']});return()=>{observer.disconnect();if(refreshTimer.current)clearTimeout(refreshTimer.current)}},[page]);

 const go=(next:string)=>{keyboard.hide();setPage(next);setQuery('');setStatus('All');setOrder(['Daily tasks','To apply','Subscriptions'].includes(next)?'Due date':'Newest');setTab('To do');setSheet('')};

 const open=(next:string)=>{keyboard.hide();setSheet(next)};const close=()=>{keyboard.hide();setSheet('')};

 const action=(label:string,fn:()=>void,primary=false,Icon=Icons.ChevronRightIcon)=><button key={label} className={'m-action '+(primary?'primary':'')} onClick={fn}><Icon/><span>{label}</span>{!primary&&<Icons.ChevronRightIcon/>}</button>;

 const fields=(label:string,value:string,setter:(v:string)=>void,multiline=false)=>{
   const options:Record<string,string[]>={Currency:['USD','PHP','AUD','CAD','EUR','GBP'],'Contract status':['Active','Contract Ended'],'Rate period':['Monthly','Hourly'],Priority:['Low','Medium','High'],'Billing cycle':['Monthly','Yearly','Weekly'],'Account':['Cash','GCash','MariBank','Wise'],Category:['Income','Expense','Payable']};
   const date=label.toLowerCase().includes('date');
   return <label className="m-field"><span>{label}</span>{(options[label]||date)?<button className="m-form-choice" type="button" onClick={()=>{keyboard.hide();fieldSetter.current=setter;setFieldTitle(label);setFieldOptions(options[label]??[]);setReturnSheet(sheet);setSheet(date?'Calendar':'Field choice')}}><span>{value||'Choose '+label.toLowerCase()}</span>{date?<Icons.CalendarIcon/>:<Icons.ChevronDownIcon/>}</button>:multiline?<KeyboardTextarea value={value} onChange={e=>setter(e.target.value)} onBlur={()=>keyboard.hide()} rows={5}/>:<KeyboardInput value={value} onChange={e=>setter(e.target.value)} onBlur={()=>keyboard.hide()}/>}</label>
 };

 const tabs=(options:string[],value:string,setter:(v:string)=>void)=><Tabs options={options} value={value} onChange={setter}/>;

 const search=<div className="m-search"><Icons.MagnifyingGlassIcon aria-hidden="true"/><KeyboardInput aria-label={'Search '+page} placeholder={'Search '+page.toLowerCase()} value={query} onChange={e=>setQuery(e.target.value)} onBlur={()=>keyboard.hide()}/>{query&&<button className="m-search-clear" aria-label="Clear search" type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>setQuery('')}><Icons.Cross2Icon/></button>}</div>;

 const profile=(clickable=true)=><button className="m-profile m-card" onClick={()=>clickable?go('Account'):setNotice('Sample profile · the app uses your account photo when available')}><span className="m-user-avatar">JV</span><span className="m-profile-copy"><strong>Jeff VA</strong><small>jeff@example.com</small><span className="m-provider"><Icons.CheckCircledIcon/> Google account · Sample</span></span>{clickable&&<Icons.ChevronRightIcon/>}</button>;

 const row=(entry:Entry,destination=page)=><button key={entry.id} className="m-list-row m-card" onClick={()=>{setSelected(entry);open(destination==='Active clients'?'Client profile':'Record details')}}>{destination==='Active clients'?<ClientAvatar name={entry.title}/>:<span className="m-icon-tile"><AppIcon page={destination}/></span>}<span className="m-row-copy"><strong>{entry.title}</strong><small>{entry.subtitle}</small><span className="m-row-meta">{entry.date}<Badge value={entry.status}/></span></span><span className="m-row-end">{entry.amount!==undefined&&<strong>{entry.status==='Income'?'+':entry.status==='Expense'?'−':''}₱{entry.amount.toLocaleString('en-US',{minimumFractionDigits:2})}</strong>}<Icons.ChevronRightIcon className="m-row-chevron"/></span></button>;

 const addActions:Record<string,string>={Applications:'Add application','Daily tasks':'Add task','To apply':'Add reminder',Wallet:'Add transaction',Subscriptions:'Add subscription',Scripts:'Add script','Softcopy links':'Add softcopy link',Documents:'Upload document'};const addLabel=addActions[page]??'';

 const add=()=>{setEditingEntry(false);setFormValues({});setItemName('');setItemDetail('');setItemDate('2026-10-29');open('Add item')};

 const saveSample=()=>{if(!itemName.trim()){setNotice('Enter a name or title first');return}if(page==='Daily tasks')setTaskRows(rows=>[...rows,{id:'t'+Date.now(),title:itemName,client:itemDetail,date:itemDate,created:'2026-10-29',done:false}]);else setEntries(all=>({...all,[page]:editingEntry?(all[page]??[]).map(e=>e.id===selected?.id?{...e,title:itemName,subtitle:itemDetail,date:itemDate}:e):[...(all[page]??[]),{id:'sample'+Date.now(),title:itemName,subtitle:itemDetail,date:itemDate,status:page==='Subscriptions'?'Active':page==='Applications'?'Applied':'Saved'}]}));close();setNotice('Added to the sample preview')};

 const toggleTask=(id:string)=>setTaskRows(rows=>rows.map(t=>t.id===id?{...t,done:!t.done}:t));

 const compose=(forward=false)=>{setRecipient(forward?'':(currentMail.from.match(/<([^>]+)>/)?.[1]??currentMail.from));setSubject((forward?'Fwd: ':'Re: ')+currentMail.title);setCopy(forward?'\n\nForwarded message\n'+currentMail.body:'');open('Compose email')};

 const mailFlag=(key:'star'|'read'|'archived')=>{setMail(rows=>rows.map(m=>m.id===mailId?{...m,[key]:!m[key]}:m));close()};

 const visibleMail=mail.filter(m=>(folder==='Inbox'?!m.sent&&!m.archived:folder==='Sent'?m.sent&&!m.archived:folder==='Starred'?m.star:m.archived)&&(m.from+' '+m.to+' '+m.title).toLowerCase().includes(query.toLowerCase()));
 const mailName=(address:string)=>address.replace(/\s*<[^>]*>.*/, '').replace(/"/g,'').trim()||address;
 const mailInitials=(name:string)=>name.trim().split(/\s+/).filter(Boolean).map(part=>part[0]).filter((_,i,parts)=>i===0||i===parts.length-1).join('').toUpperCase();
 const visibleTasks=taskRows.filter(t=>t.done===(tab==='Completed')&&(t.title+' '+t.client).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>order==='Title'?a.title.localeCompare(b.title):order==='Newest'?b.created.localeCompare(a.created):(a.date||'9999-12-31').localeCompare(b.date||'9999-12-31'));

 const visibleEntries=(entries[page]??[]).filter(e=>(status==='All'||e.status===status)&&(e.title+' '+e.subtitle).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>order==='Name'?a.title.localeCompare(b.title):order==='Oldest'||order==='Due date'?a.date.localeCompare(b.date):b.date.localeCompare(a.date));

 const sortOptions=page==='Daily tasks'?['Due date','Newest','Title']:['To apply','Subscriptions'].includes(page)?['Due date','Newest','Name']:['Newest','Oldest','Name'];

 const picker=(label:string,value:string,fn:()=>void)=>{const list=label.startsWith('Sort')||label==='Show';return <button className={'m-picker '+(list?'m-list-picker ':'')+(label==='Show'&&value!=='All'?'is-filtered':'')} aria-label={label+': '+value} onClick={fn}>{label.startsWith('Sort')?<Icons.ArrowDownIcon/>:<Icons.MixerHorizontalIcon/>}{!list&&<span>{label}</span>}<strong>{value==='All'?(page==='Wallet'?'All types':'All statuses'):value}</strong><Icons.ChevronDownIcon/></button>};
 const choiceOption=(value:string,selected:string,onChoose:()=>void,sort=false)=>{const Icon=sort?(value==='Due date'?Icons.CalendarIcon:value==='Name'||value==='Title'?Icons.TextAlignLeftIcon:Icons.ClockIcon):Icons.MixerHorizontalIcon;const hint=value==='Due date'?'Soonest due first':value==='Newest'?'Most recently added':value==='Oldest'?'Earliest added first':'A to Z';return <button key={value} role="radio" aria-checked={value===selected} className={'m-choice-option '+(value===selected?'selected':'')} onClick={onChoose}><span className="m-choice-icon"><Icon/></span><span className="m-choice-copy"><strong>{value}</strong>{sort&&<small>{hint}</small>}</span><span className="m-choice-radio">{value===selected?<Icons.CheckCircledIcon/>:<Icons.CircleIcon/>}</span></button>};

 const monthly=Number(rate)>=0&&Number(hours)>0&&Number(hours)<=168?(payType==='Monthly'?Number(rate):Number(rate)*Number(hours)*52/12):NaN;

 const days=['Fri','Sat','Sun','Mon','Tue','Wed','Thu'];const stat=(label:string,value:string,destination:string)=><button className="m-stat" onClick={()=>go(destination)}><small>{label}</small><strong>{value}</strong></button>;

 const renderEntries=()=> <>{visibleEntries.length?visibleEntries.map(e=>row(e)):<div className="m-empty"><AppIcon page={page} size={28}/><h3>No matching items</h3><p>Try a different search or filter.</p></div>}</>;

 return <>{createPortal(<aside className="jv-preview-help"><div className="jv-preview-tag">JEFF VA · ANDROID 1.3.3</div><h1>A clearer<br/>workday.</h1><p>Modern lists, focused actions and your workspace in one place.</p><div className="jv-preview-links">{['Daily tasks','More','Account','Settings','Applications','Wallet'].map(name=><button key={name} onClick={()=>go(name)}>{name}<Icons.ArrowTopRightIcon/></button>)}</div><p className="jv-preview-small">Interactive design preview · sample data. Android rendering may differ. Your account is not connected.</p></aside>,document.body)}

 <div className={'jv-app m-app '+(dark?'dark':'')}><header className="jv-header m-header"><span className="m-icon-tile"><AppIcon page={page}/></span><div className="m-header-copy"><div className="jv-brand">JEFF VA / WORKSPACE</div><h2>{page}</h2></div>{addLabel&&<button className="jv-icon-button jv-header-add" aria-label={addLabel} onClick={add}>+</button>}</header>

 <div className="jv-scroll-host" ref={scrollHost} key={page} onPointerUpCapture={()=>{if(armed.current)refresh()}} onPointerCancelCapture={()=>{armed.current=false;setPull(0)}} onWheelCapture={event=>{const scroll=scrollHost.current?.querySelector<HTMLElement>('.mobile-scroll');if(!scroll||scroll.scrollTop>0||event.deltaY>=0||refreshingRef.current)return;const now=Date.now();if(now-wheelTime.current>450)wheelAmount.current=0;wheelTime.current=now;wheelAmount.current-=event.deltaY;if(wheelAmount.current>=120)refresh()}}>

 {(pull>8||refreshing)&&<div className="jv-pull-indicator" role="status"><Icons.ReloadIcon className={refreshing?'jv-spinning':''}/>{refreshing?'Refreshing…':pull>=42?'Release to refresh':'Pull to refresh'}</div>}

 <MobileScroll className="jv-scroll"><main className="jv-content m-content">

 {page==='Daily tasks'&&<><p className="m-intro">{taskRows.filter(t=>!t.done).length} to do <span>·</span> {taskRows.filter(t=>t.done).length} completed</p>{tabs(['To do','Completed'],tab,v=>{setTab(v);setOrder(v==='Completed'?'Newest':'Due date')})}{search}<div className="m-list-controls">{picker('Sort tasks',order,()=>open('Sort'))}</div><div className="m-section-title"><h3>{tab==='Completed'?'Completed work':'Your next steps'}</h3><span>{visibleTasks.length} tasks</span></div>{visibleTasks.map(t=><article className={'m-task m-card '+(t.done?'completed':'')} key={t.id}><div className="m-task-top"><button role="checkbox" aria-checked={t.done} aria-label={(t.done?'Move to To do: ':'Complete task: ')+t.title} className="m-task-check" onClick={()=>toggleTask(t.id)}>{t.done?<Icons.CheckCircledIcon/>:<Icons.SquareIcon/>}</button><button className="m-task-title" onClick={()=>{setSelectedTask(t.id);open('Task details')}}>{t.title}</button><button className="m-menu-button" aria-label={'Actions for '+t.title} onClick={()=>{setSelectedTask(t.id);open('Task actions')}}><Icons.DotsHorizontalIcon/></button></div><p>{t.client}</p><div className="m-task-bottom"><Badge value={t.done?'Completed':t.date<'2026-10-29'?'Overdue':t.date==='2026-10-29'?'Due today':'Upcoming'}/><span><Icons.CalendarIcon/>{t.date==='2026-10-29'?'Today':t.date}</span></div></article>)}{!visibleTasks.length&&<div className="m-empty"><Icons.CheckCircledIcon/><h3>{tab==='To do'?"You’re all caught up":'No completed tasks yet'}</h3><p>{tab==='To do'?'Your next tasks will appear here.':'Finish a task to see it in this list.'}</p></div>}</>}

 {page==='More'&&<>{profile()}{moreGroups.map(group=><section className="m-nav-group" key={group.title}><h3 className="m-group-label">{group.title}</h3><div className="m-card m-group-card">{group.pages.map(name=><button className="m-nav-row" key={name} onClick={()=>go(name)}><span className="m-icon-tile"><AppIcon page={name}/></span><span><strong>{name}</strong><small>{descriptions[name]}</small></span><Icons.ChevronRightIcon/></button>)}</div></section>)}</>}

 {page==='Dashboard'&&<>{tabs(['Application','Client'],client?'Client':'Application',v=>setClient(v==='Client'))}<p className="m-intro">Thursday, October 29</p><div className="m-section-title"><h3>{client?'Client dashboard':'Application dashboard'}</h3></div><div className="jv-stats">{client?<>{stat('Active clients','2','Active clients')}{stat('Ending in 30 days','0','Active clients')}{stat('Contracts ended','1','Active clients')}{stat('Open client tasks','3','Daily tasks')}</>:<>{stat('Applications','24','Applications')}{stat('Applied today','2','Applications')}{stat('Interviews','3','Applications')}{stat('Follow-ups due','4','Applications')}</>}</div><div className="m-card m-chart-panel"><h3>{client?'Logged hours':'Application pipeline'}</h3><p className="m-intro">{client?'Client work · last 7 days':'Your current application stages'}</p><Chart values={client?[2.5,0,0,4,3.5,5,2]:[12,4,3,3,2,0]} labels={client?days:['Applied','Ongoing','To proceed','Interview','Not selected','Other']} donut={!client}/></div>{!client&&<div className="m-card m-chart-panel"><h3>Application activity</h3><p className="m-intro">Applications submitted · last 7 days</p><Chart values={[2,0,1,4,3,2,2]} labels={days}/></div>}<h3 className="m-group-label">{client?'Your clients':'Recent applications'}</h3>{(entries[client?'Active clients':'Applications']??[]).map(e=>row(e,client?'Active clients':'Applications'))}</>}

 {['Applications','Active clients','To apply','Wallet','Subscriptions','Documents','Invoices','Scripts','Softcopy links','Templates'].includes(page)&&<>

 {page==='Wallet'&&<div className="m-card m-wallet-summary"><span className="m-wallet-caption"><Icons.CardStackIcon/> Total balance</span><strong>₱11,850.00</strong><p>₱10,350.00 after payments due</p><div><span>Income <b>₱12,500</b></span><span>Expenses <b>₱650</b></span></div></div>}

 {page==='Templates'&&<p className="m-intro">Saved email templates. Document template testing remains available on the website.</p>}{search}

 <div className="m-list-controls">{['Applications','Active clients','Invoices','Subscriptions','Wallet'].includes(page)&&picker('Show',status,()=>open('Filter'))}

 {['Applications','Active clients','To apply','Documents','Scripts','Softcopy links','Templates','Wallet'].includes(page)&&picker('Sort',order,()=>open('Sort'))}</div>

 <div className="m-section-title"><h3>{page==='Wallet'?'Transactions':page==='Documents'?'Saved files':'Your '+page.toLowerCase()}</h3><span>{visibleEntries.length} items</span></div>{renderEntries()}</>}

 {page==='Email inbox'&&<>{tabs(['Inbox','Sent','Starred','Archived'],folder,setFolder)}{search}<div className="m-section-title m-mail-heading"><h3>{folder}</h3><span>{visibleMail.length} {visibleMail.length===1?'message':'messages'}</span></div><section className="m-mail-list" aria-label={folder+' messages'}>{visibleMail.map((m,index)=>{const name=mailName(m.sent?m.to:m.from),unread=!m.sent&&!m.read;return <article className={'m-mail-row '+(unread?'unread':'read')} key={m.id}><button className="m-mail-open" aria-label={'Open '+m.title} onClick={()=>{setMailId(m.id);open('Message')}}><span className={'m-mail-avatar tone-'+index%4} aria-hidden="true">{mailInitials(name)}</span><span className="m-mail-copy"><strong>{name}</strong><span className="m-mail-subject"><span className="m-mail-subject-text">{m.title}</span>{m.star&&<Icons.StarFilledIcon aria-label="Starred"/>}</span><span className="m-mail-snippet">{m.body}</span></span></button><div className="m-mail-trailing"><time>{m.date}</time><button className="m-mail-menu" aria-label={'Actions for '+m.title} onClick={()=>{setMailId(m.id);open('Email actions')}}><Icons.DotsHorizontalIcon/></button></div></article>})}</section>{!visibleMail.length&&<div className="m-empty"><Icons.EnvelopeClosedIcon/><h3>{query?'No matching emails':'No messages here'}</h3><p>{query?'Try another sender, recipient or subject.':'Choose another folder or pull down to refresh.'}</p></div>}{action('Check last email delivery',()=>setNotice('No pending send in this sample preview'),false,Icons.PaperPlaneIcon)}<p className="m-mail-note">Stars, read status and archives organize your Jeff VA workspace.</p></>}


 {page==='Industry news'&&<>{tabs(['All news','AI tools','Automation','Virtual assistants','Web'],topic,setTopic)}<p className="m-intro m-small">Sample stories · design preview</p>{stories.map(story=><article className="m-card m-news" key={story.title}><section className="m-news-media"><span><Icons.ReaderIcon/> {story.source}</span><img src={story.image} alt="Remote work workspace" onError={event=>{event.currentTarget.style.display='none'}}/></section><div><small>{story.source} · Oct 29</small><h3>{story.title}</h3><p>{story.description}</p>{action('Read article',()=>{setSelected({id:'story',title:story.title,subtitle:story.source,date:'2026-10-29',status:'Sample story',body:story.description});open('Record details')},false,Icons.ExternalLinkIcon)}</div></article>)}</>}

 {page==='Settings'&&<>{profile()}<div className="m-card m-settings"><h3><Icons.MoonIcon/> Appearance</h3><label className="m-toggle"><span><strong>Dark mode</strong><small>Switch to a darker workspace</small></span><input type="checkbox" checked={dark} onChange={e=>setDark(e.target.checked)}/></label></div><div className="m-card m-settings"><h3><Icons.UpdateIcon/> Live workspace updates</h3><p className="m-intro">The Android app listens for saved workspace changes while it is open. This browser preview uses sample data.</p><strong className="m-sync-pending">Background push: setup required</strong><p className="m-intro">Notifications while the app is closed are not connected yet. Daily reminders use the last synced data. New Gmail delivery also needs a server connection.</p></div><div className="m-card m-settings"><h3><Icons.BellIcon/> Notifications</h3><p className="m-intro">Daily reminders around 9 AM using your last synced tasks and renewals.</p><label className="m-toggle"><span><strong>Mobile reminders</strong><small>Allow daily summaries on this phone</small></span><input type="checkbox" checked={notifications} onChange={e=>setNotifications(e.target.checked)}/></label><label className="m-toggle"><span><strong>Tasks due and overdue</strong></span><input type="checkbox" checked={notifyTasks} onChange={e=>setNotifyTasks(e.target.checked)}/></label><label className="m-toggle"><span><strong>Upcoming renewals</strong><small>Subscriptions ending within 7 days</small></span><input type="checkbox" checked={notifyRenewals} onChange={e=>setNotifyRenewals(e.target.checked)}/></label>{action('Phone notification settings',()=>setNotice('The Android app opens phone settings here'),false,Icons.GearIcon)}{action('Send a test notification',()=>setNotice(notifications?'Preview: 3 tasks due · 1 renewal':'Enable mobile reminders first'),false,Icons.BellIcon)}</div>{action('Account & security',()=>go('Account'),false,Icons.IdCardIcon)}{action('Sign out',()=>open('Sign out'),false,Icons.ExitIcon)}<p className="m-footer-note">Jeff VA 1.3.3 · Android</p></>}

 {page==='Account'&&<>{profile(false)}<div className="m-card m-account-details"><h3>Account details</h3><dl><div><dt>Email</dt><dd>jeff@example.com</dd></div><div><dt>Sign-in provider</dt><dd><Icons.CheckCircledIcon/> Google</dd></div><div><dt>Member since</dt><dd>September 2026</dd></div></dl></div><h3 className="m-group-label">Connections</h3><div className="m-card m-group-card"><button className="m-nav-row" onClick={()=>setNotice('Google reconnect is available in the Android app')}><span className="m-icon-tile"><Icons.EnvelopeClosedIcon/></span><span><strong>Google / Gmail</strong><small>Reconnect your email account</small></span><Icons.ChevronRightIcon/></button><button className="m-nav-row" onClick={()=>go('Settings')}><span className="m-icon-tile"><Icons.GearIcon/></span><span><strong>App settings</strong><small>Appearance and mobile notifications</small></span><Icons.ChevronRightIcon/></button></div><div className="m-card m-connection"><Icons.CheckCircledIcon/><div><strong>Connected to your workspace</strong><p>Your account uses the same saved data as the website.</p></div></div>{action('Send password reset email',()=>open('Password reset'),false,Icons.LockClosedIcon)}<p className="m-footer-note">Profile photo appears when available from your sign-in provider.</p></>}

 {page==='Salary'&&<><p className="m-intro">Estimate monthly pay using the same 52-week calculation as the website.</p><div className="m-card m-form">{picker('Pay type',payType,()=>open('Pay type'))}{picker('Currency',currency,()=>open('Currency'))}{fields(payType==='Hourly'?'Hourly rate':'Monthly salary',rate,setRate)}{fields('Hours per week',hours,setHours)}</div><div className="m-card m-result"><small>Monthly equivalent</small><strong>{Number.isFinite(monthly)?currency+' '+monthly.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'Enter a valid rate'}</strong><p>{Number.isFinite(monthly)?'Hourly equivalent: '+currency+' '+(monthly*12/(Number(hours)*52)).toFixed(2):'Hours must be greater than 0 and at most 168.'}</p></div><p className="m-footer-note">Estimate before fees and taxes. Currency conversion is not applied.</p></>}

 {page==='Cover letter'&&<><p className="m-intro">Write a letter draft, then copy or share the text. Drafts are local to this device.</p><div className="m-card m-form">{fields('Hiring manager',letterName,setLetterName)}{fields('Company',letterCompany,setLetterCompany)}{fields('Position',letterRole,setLetterRole)}{fields('Letter body',letterBody,setLetterBody,true)}</div>{action('Save local draft',()=>setNotice('Sample draft saved for this preview session'),true,Icons.CheckIcon)}{action('Copy letter text',()=>{navigator.clipboard?.writeText('Dear '+letterName+',\n\n'+letterBody);setNotice('Letter text copied')},false,Icons.CopyIcon)}</>}

 {page==='Weekly report'&&<><div className="m-card m-chart-panel"><h3>This week</h3><p className="m-intro">October 26–29, 2026</p><div className="m-report-stats"><div><Icons.FileTextIcon/><strong>11</strong><span>Applications</span></div><div><Icons.CheckCircledIcon/><strong>8</strong><span>Completed</span></div><div><Icons.ClockIcon/><strong>14.5</strong><span>Hours logged</span></div></div><Chart values={[2,0,1,4,3,2,2]} labels={days}/></div>{action('Share weekly report',()=>setNotice('Sample weekly report ready to share'),true,Icons.Share1Icon)}</>}

 {page==='Assistant'&&<><div className="m-card m-assistant-intro"><span className="m-icon-tile"><Icons.MagicWandIcon/></span><h3>How can I help today?</h3><p>Research a topic or work through an idea with your assistant.</p></div><div className="m-card m-form">{fields('Your question',copy,setCopy,true)}{action('Ask assistant',()=>setNotice('Research requests are available in the signed-in Android app'),true,Icons.PaperPlaneIcon)}</div></>}

 </main></MobileScroll></div>

 <nav className="jv-nav m-nav" aria-label="App navigation">{nav.map(([p,label])=><button key={p} aria-current={page===p?'page':undefined} className={page===p||(p==='More'&&!nav.some(n=>n[0]===page))?'active':''} onClick={()=>go(p)}><AppIcon page={p}/><span>{label}</span></button>)}</nav>{notice&&<div className="jv-toast" role="status">{notice}</div>}

 <BottomSheet open={!!sheet} onOpenChange={v=>{if(!v)close()}} title={sheet==='Field choice'||sheet==='Calendar'?fieldTitle:sheet==='Add item'?(editingEntry?'Edit '+(selected?.title??'record'):addLabel):sheet==='Task details'?currentTask?.title??'Task details':sheet==='Message'?currentMail.title:sheet} description="Sample data · design preview" snap={.88}><div className="m-sheet" data-theme={dark?'dark':'light'} data-kind={['Email actions','Task actions','Sort','Filter','Currency','Pay type','Field choice'].includes(sheet)?'menu':'content'}><button className="m-sheet-close" aria-label="Close panel" onClick={close}><Icons.Cross2Icon/></button><span className="m-sheet-mark"><AppIcon page={page}/></span>

 {sheet==='Field choice'&&<>{fieldOptions.map(value=>action(value,()=>{fieldSetter.current(value);setSheet(returnSheet)},false,Icons.CircleIcon))}{action('Cancel',()=>setSheet(returnSheet),false,Icons.Cross2Icon)}</>}
 {sheet==='Calendar'&&<><div className="m-calendar"><h3>October 2026</h3><div className="m-calendar-grid">{['M','T','W','T','F','S','S'].map((day,i)=><small key={'day'+i}>{day}</small>)}{[0,1,2].map(i=><span key={'blank'+i}/>)}{Array.from({length:31},(_,i)=>i+1).map(day=><button key={day} onClick={()=>{fieldSetter.current('2026-10-'+String(day).padStart(2,'0'));setSheet(returnSheet)}}>{day}</button>)}</div></div><div className="m-sheet-footer">{action('Cancel',()=>setSheet(returnSheet),false,Icons.Cross2Icon)}{action('Clear date',()=>{fieldSetter.current('');setSheet(returnSheet)},false,Icons.CalendarIcon)}</div></>}
 {sheet==='Sort'&&<div role="radiogroup" aria-label="Sort by" className="m-choice-list">{sortOptions.map(value=>choiceOption(value,order,()=>{setOrder(value);close()},true))}</div>}

 {sheet==='Filter'&&<div role="radiogroup" aria-label="Filter by status" className="m-choice-list">{(page==='Applications'?['All','Applied','Ongoing','To Proceed','Interview','Not selected']:page==='Active clients'?['All','Active','Contract ended']:page==='Invoices'?['All','Unpaid','Paid']:page==='Subscriptions'?['All','Active','Expired','Cancelled']:['All','Income','Expense','Payable']).map(value=>choiceOption(value,status,()=>{setStatus(value);close()}))}</div>}

 {sheet==='Pay type'&&['Hourly','Monthly'].map(value=>action(value,()=>{setPayType(value);close()},value===payType,Icons.TableIcon))}

 {sheet==='Currency'&&['USD','PHP','AUD','CAD','EUR','GBP'].map(value=>action(value,()=>{setCurrency(value);close()},value===currency,Icons.TableIcon))}

 {sheet==='Add item'&&<>{fields(page==='Daily tasks'?'Task title':page==='Applications'?'Company / client':page==='Subscriptions'?'Subscription name':'Name / title',itemName,setItemName)}{fields(page==='Daily tasks'?'Client / related record':page==='Applications'?'Role':'Details',itemDetail,setItemDetail)}{fields('Date (YYYY-MM-DD)',itemDate,setItemDate)}{(page==='Applications'?['Contact name','Email','Phone','Location','Website','Platform','Follow-up date']:page==='Subscriptions'?['Amount','Currency','Billing cycle','Renewal date','Website']:page==='Wallet'?['Amount','Currency','Account','Category']:page==='To apply'?['Job link']:page==='Softcopy links'?['URL']:page==='Daily tasks'?['Priority']:[]).map(label=><div key={label}>{fields(label,formValues[label]??'',value=>setFormValues(old=>({...old,[label]:value})))}</div>)}{fields('Notes',formValues.Notes??'',value=>setFormValues(old=>({...old,Notes:value})),true)}<div className="m-sheet-footer">{action('Cancel',close,false,Icons.Cross2Icon)}{action('Save sample',saveSample,true,Icons.CheckIcon)}</div></>}

 {sheet==='Edit client'&&<>{['Client name','Contact name','Role','Email','Phone','Location','Website','Platform','Rate amount','Currency','Rate period','Hours per week','Contract end date','Contract status','Notes'].map(label=><div key={label}>{fields(label,formValues[label]??(label==='Client name'?selected?.title??'':label==='Role'?selected?.subtitle??'':label==='Currency'?'USD':label==='Contract status'?'Active':''),value=>setFormValues(old=>({...old,[label]:value})),label==='Notes')}</div>)}<div className="m-sheet-footer">{action('Cancel',()=>open('Client profile'),false,Icons.Cross2Icon)}{action('Save sample changes',()=>{setNotice('Preview only — client changes were not sent');open('Client profile')},true,Icons.CheckIcon)}</div></>}

 {sheet==='Client task editor'&&<>{fields('Task title',itemName,setItemName)}{fields('Related client',itemDetail,setItemDetail)}{fields('Due date',itemDate,setItemDate)}{fields('Notes',formValues.Notes??'',value=>setFormValues(old=>({...old,Notes:value})),true)}<div className="m-sheet-footer">{action('Cancel',()=>open('Client profile'),false,Icons.Cross2Icon)}{action('Save sample task',()=>{if(!itemName.trim()){setNotice('Enter a task title');return}setTaskRows(rows=>[...rows,{id:'ct'+Date.now(),title:itemName,client:itemDetail,date:itemDate,created:'2026-10-30',done:false}]);open('Client profile')},true,Icons.CheckIcon)}</div></>}

 {sheet==='Upload document'&&<><div className="m-empty"><Icons.UploadIcon width={28} height={28}/><h3>PDF or Word document</h3><p>The Android app opens your phone’s document picker here.</p></div>{action('Choose sample document',()=>{setNotice('Preview only — no file was uploaded');close()},true,Icons.FileIcon)}</>}



 {sheet==='Task actions'&&<>{action('View details',()=>open('Task details'),false,Icons.ReaderIcon)}{action(currentTask?.done?'Move to To do':'Mark complete',()=>{toggleTask(selectedTask);close()},false,Icons.CheckCircledIcon)}{action('Edit task',()=>{setItemName(currentTask?.title??'');setItemDetail(currentTask?.client??'');setItemDate(currentTask?.date??'');open('Edit task')},false,Icons.Pencil1Icon)}</>}

 {sheet==='Task details'&&<><Badge value={currentTask?.done?'Completed':'To do'}/><dl className="m-details"><div><dt>Related client</dt><dd>{currentTask?.client}</dd></div><div><dt>Due date</dt><dd>{currentTask?.date}</dd></div></dl>{action(currentTask?.done?'Move to To do':'Mark complete',()=>{toggleTask(selectedTask);close()},true,Icons.CheckCircledIcon)}</>}

 {sheet==='Edit task'&&<>{fields('Task title',itemName,setItemName)}{fields('Related client',itemDetail,setItemDetail)}{fields('Due date',itemDate,setItemDate)}{action('Save sample changes',()=>{setTaskRows(rows=>rows.map(t=>t.id===selectedTask?{...t,title:itemName,client:itemDetail,date:itemDate}:t));close()},true,Icons.CheckIcon)}</>}

 {sheet==='Client profile'&&selected&&<><div className="m-client-profile"><ClientAvatar name={selected.title} large/><div><h3>{selected.title}</h3><p>{selected.subtitle}</p><Badge value={selected.status}/></div></div><dl className="m-details">{[['Contact','Alex Rivera'],['Email','alex@example.com'],['Location','Philippines'],['Rate','USD 1,000 / month']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><h3>Client tasks</h3>{tabs(['To do','Completed'],tab,setTab)}{taskRows.filter(t=>t.client===selected.title&&t.done===(tab==='Completed')).map(t=><div className="m-client-task" key={t.id}><Icons.CheckboxIcon/><span>{t.title}</span><Badge value={t.done?'Completed':t.date}/></div>)}{action('Add client task',()=>{setItemName('');setItemDetail(selected.title);setItemDate('2026-10-30');open('Client task editor')},false,Icons.PlusIcon)}<h3>Documents</h3>{action('Upload PDF or Word document',()=>open('Upload document'),false,Icons.UploadIcon)}<div className="m-sheet-footer">{action('Close',close,false,Icons.Cross2Icon)}{action('Edit client',()=>open('Edit client'),true,Icons.Pencil1Icon)}</div></>}

 {sheet==='Record details'&&selected&&<><div className="m-record-heading"><span className="m-icon-tile"><AppIcon page={page}/></span><div><h3>{selected.title}</h3><p>{selected.subtitle}</p></div></div><Badge value={selected.status}/><p>{selected.body??'Saved on '+selected.date+'. This is sample content for reviewing the Android design.'}</p>{selected.url&&action('Open saved link',()=>setNotice('Sample link: '+selected.url),false,Icons.ExternalLinkIcon)}{page==='Invoices'&&action(selected.status==='Paid'?'Edit payment':'Record payment',()=>{setEntries(all=>({...all,Invoices:all.Invoices.map(e=>e.id===selected.id?{...e,status:'Paid'}:e)}));close();setNotice('Sample payment recorded')},true,Icons.CheckCircledIcon)}{page==='Subscriptions'&&action('Manage subscription',()=>{setNotice('Sample renewal: '+selected.date);close()},false,Icons.UpdateIcon)}{['Scripts','Templates'].includes(page)&&action('Copy text',()=>{navigator.clipboard?.writeText(selected.body??'');setNotice('Text copied')},false,Icons.CopyIcon)}{['To apply','Wallet'].includes(page)&&action('Delete record',()=>open('Delete record'),false,Icons.TrashIcon)}<div className="m-sheet-footer">{action('Close',close,false,Icons.Cross2Icon)}{['Applications','To apply','Wallet','Scripts','Softcopy links'].includes(page)&&action('Edit',()=>{setEditingEntry(true);setFormValues({});setItemName(selected.title);setItemDetail(selected.subtitle);setItemDate(selected.date);open('Add item')},true,Icons.Pencil1Icon)}</div></>}

 {sheet==='Email actions'&&<>{action('Reply',()=>compose(),false,Icons.PaperPlaneIcon)}{action('Forward',()=>compose(true),false,Icons.ArrowRightIcon)}{action(currentMail.star?'Remove star':'Star message',()=>mailFlag('star'),false,Icons.StarIcon)}{action(currentMail.read?'Mark unread':'Mark read',()=>mailFlag('read'),false,Icons.EnvelopeClosedIcon)}{action(currentMail.archived?'Move to inbox':'Archive in app',()=>mailFlag('archived'),false,Icons.ArchiveIcon)}{action('Copy sender address',()=>{navigator.clipboard?.writeText(currentMail.from.match(/<([^>]+)>/)?.[1]??currentMail.from);close();setNotice('Sample sender address copied')},false,Icons.CopyIcon)}{action('Cancel',close,false,Icons.Cross2Icon)}</>}

 {sheet==='Message'&&<><p className="m-intro">From: {currentMail.from} · {currentMail.date}</p><p>{currentMail.body}</p>{action('Reply',()=>compose(),true,Icons.PaperPlaneIcon)}{action('Forward',()=>compose(true),false,Icons.ArrowRightIcon)}{action('More email actions',()=>open('Email actions'),false,Icons.DotsHorizontalIcon)}</>}

 {sheet==='Compose email'&&<>{fields('To',recipient,setRecipient)}{fields('Subject',subject,setSubject)}{fields('Message',copy,setCopy,true)}<div className="m-sheet-footer">{action('Cancel',close,false,Icons.Cross2Icon)}{action('Send preview',()=>open('Send this email?'),true,Icons.PaperPlaneIcon)}</div></>}

 {sheet==='Send this email?'&&<><dl className="m-details"><div><dt>To</dt><dd>{recipient||'No recipient entered'}</dd></div><div><dt>Subject</dt><dd>{subject}</dd></div></dl><p>Preview only. This action does not send an email.</p><div className="m-sheet-footer">{action('Review',()=>open('Compose email'),false,Icons.Pencil1Icon)}{action('Confirm preview',()=>{close();setNotice('Preview only - no email was sent')},true,Icons.PaperPlaneIcon)}</div></>}
 {sheet==='Delete record'&&<><p>Delete this sample record from the preview? Your actual account is not connected.</p><div className="m-sheet-footer">{action('Cancel',()=>open('Record details'),false,Icons.Cross2Icon)}{action('Delete sample',()=>{setEntries(all=>({...all,[page]:(all[page]??[]).filter(e=>e.id!==selected?.id)}));close()},true,Icons.TrashIcon)}</div></>}
 {sheet==='Password reset'&&<><p>The Android app sends a reset link to your signed-in email after confirmation.</p>{action('Preview reset link',()=>{close();setNotice('Preview only — no email was sent')},true,Icons.LockClosedIcon)}</>}

 {sheet==='Sign out'&&<><p>Your cloud data stays in your account. Local drafts and this device’s saved session are removed on sign-out.</p>{action('Sign out of preview',()=>{close();setNotice('Preview only — your account is not connected')},true,Icons.ExitIcon)}</>}

 </div></BottomSheet>

 </div></>

}
