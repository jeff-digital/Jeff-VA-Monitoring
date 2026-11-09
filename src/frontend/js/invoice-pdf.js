(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JeffInvoicePdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(document, jsPDF, engine) {
    const d=engine.validateDocument(document), totals=engine.calculate(d);
    if(typeof jsPDF!=='function')throw new Error('The PDF library is unavailable. Reconnect and reload before downloading.');
    const pdf=new jsPDF({unit:'mm',format:'a4',compress:true});
    const left=18,right=192,width=174,bottom=270;
    const ink=[22,43,65],muted=[95,108,120],border=[219,226,234],tint=[244,247,250];
    let y=16;
    const font=(size=9.5,bold=false,color=ink)=>{pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(...color);};
    const wrap=(value,maxWidth,size=9.5,bold=false)=>{font(size,bold);return pdf.splitTextToSize(String(value || '').replace(/\r/g,''),maxWidth);};
    const money=value=>d.currency==='USD'?'$'+new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100):engine.money(value,d.currency).replace(/\u00a0/g,' ');
    const text=(value,x,baseline,size=9.5,bold=false,color=ink,options={})=>{font(size,bold,color);pdf.text(value,x,baseline,options);};
    const rule=(baseline,x1=left,x2=right)=>{pdf.setDrawColor(...border);pdf.setLineWidth(.25);pdf.line(x1,baseline,x2,baseline);};
    function nextPage(){
      pdf.addPage();
      const company=wrap(d.issuer.name,125,9.5,true),number=wrap(d.invoiceNumber,40,8.5,true);
      text(company,left,18,9.5,true);text(number,right,18,8.5,true,muted,{align:'right'});
      y=20+Math.max(company.length*4,number.length*3.5);rule(y);y+=9;
    }
    function space(height){if(y+height>bottom)nextPage();}
    function fitText(value,x,baseline,maxWidth,size=9.5,bold=false,color=ink){
      font(size,bold,color);
      const actual=Math.min(size,size*maxWidth/Math.max(pdf.getTextWidth(String(value)),maxWidth));
      text(String(value),x,baseline,actual,bold,color,{align:'right'});
    }
    let businessX=left;
    if(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(d.issuer.logo || '') && d.issuer.logo.length<=180000){
      try{pdf.addImage(d.issuer.logo,'PNG',left,16,13,13,undefined,'FAST');businessX+=18;}
      catch{throw new Error('The saved logo cannot be read. Upload the logo again before downloading.');}
    }
    const businessWidth=100-(businessX-left),name=wrap(d.issuer.name,businessWidth,11,true);
    text(name,businessX,20,11,true);
    let businessY=20+name.length*4.4;
    for(const value of [String(d.issuer.address || '').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).join(', '),d.issuer.email,d.issuer.phone].filter(Boolean)){
      const content=wrap(value,businessWidth,8.5);text(content,businessX,businessY,8.5,false,muted);businessY+=content.length*3.6+.7;
    }
    text('INVOICE',right,22,18,true,ink,{align:'right'});
    const reference=wrap(d.invoiceNumber,55,9.5,true);text(reference,right,30,9.5,true,ink,{align:'right'});
    y=Math.max(37,businessY+3,30+reference.length*4);rule(y);y+=8;

    const clientName=wrap(d.billTo.name,77,10.5,true),clientDetails=[];
    for(const value of [d.billTo.contact,d.billTo.address,d.billTo.email].filter(Boolean))clientDetails.push(...wrap(value,77,9));
    const metadata=[['Issued',engine.formatDate(d.issueDate)],['Due date',engine.formatDate(d.dueDate)],['Billing period',`${engine.formatDate(d.periodStart)} - ${engine.formatDate(d.periodEnd)}`],['Currency',d.currency]];
    const meta=metadata.map(([label,value])=>({label,content:wrap(value,47,8.5,true)}));
    const cardHeight=Math.max(39,14+clientName.length*4.5+clientDetails.length*4,13+meta.reduce((height,item)=>height+Math.max(6.5,item.content.length*3.8+2),0));
    space(cardHeight+6);
    pdf.setDrawColor(...border);pdf.setLineWidth(.25);pdf.roundedRect(left,y,85,cardHeight,2,2,'S');pdf.roundedRect(111,y,81,cardHeight,2,2,'S');
    text('BILL TO',left+4,y+6.5,8,true,muted);text('INVOICE DETAILS',115,y+6.5,8,true,muted);
    text(clientName,left+4,y+13,10.5,true);
    if(clientDetails.length)text(clientDetails,left+4,y+13+clientName.length*4.5,9,false,muted,{lineHeightFactor:1.25});
    let metaY=y+13;
    for(const item of meta){text(item.label,115,metaY,8,false,muted);text(item.content,188,metaY,8.5,true,ink,{align:'right'});metaY+=Math.max(6.5,item.content.length*3.8+2);}
    y+=cardHeight+6;
    if(d.workSchedule){
      const duration=d.workSchedule,perDay=new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(duration.hoursPerWeek/duration.daysPerWeek);
      space(21);pdf.setFillColor(...tint);pdf.roundedRect(left,y,width,16,2,2,'F');
      [['WEEKLY HOURS',`${duration.hoursPerWeek} hours`],['WORKDAYS',`${duration.daysPerWeek} days`],['HOURS PER DAY',`${perDay} hours`]].forEach(([label,value],index)=>{
        const x=left+5+index*58;text(label,x,y+5.5,7.5,true,muted);text(value,x,y+11.5,10,true);
        if(index<2){pdf.setDrawColor(...border);pdf.line(left+(index+1)*58,y+3,left+(index+1)*58,y+13);}
      });y+=21;
    }
    const descriptionX=23,qtyRight=118,rateRight=158,amountRight=187;
    function grid(top,height){
      pdf.setDrawColor(...border);pdf.setLineWidth(.2);pdf.rect(left,top,width,height,'S');
      for(const x of [103,123,162])pdf.line(x,top,x,top+height);
    }
    function tableHeader(){
      space(25);pdf.setFillColor(...ink);pdf.rect(left,y,width,10,'F');
      text('SERVICE / DESCRIPTION',descriptionX,y+6.5,8,true,[255,255,255]);
      text(totals.lines.every(line=>line.unit==='hour')?'HOURS':'QTY',qtyRight,y+6.5,8,true,[255,255,255],{align:'right'});
      text('UNIT RATE',rateRight,y+6.5,8,true,[255,255,255],{align:'right'});text('LINE TOTAL',amountRight,y+6.5,8,true,[255,255,255],{align:'right'});y+=10;
    }
    tableHeader();
    totals.lines.forEach((line,index)=>{
      const description=wrap(line.description,76,9.5),rate=wrap(engine.rateLabel(line,d.currency),31,9);
      const height=Math.max(15,description.length*4.3+7,rate.length*4.1+7);
      if(y+height>bottom){nextPage();tableHeader();}
      if(index%2){pdf.setFillColor(249,250,252);pdf.rect(left,y,width,height,'F');}grid(y,height);
      const baseline=y+6.3;text(description,descriptionX,baseline,9.5,false,ink,{lineHeightFactor:1.25});
      fitText(line.quantity,qtyRight,baseline,11,9.5);text(rate,rateRight,baseline,9,false,ink,{align:'right',lineHeightFactor:1.25});fitText(money(line.amountCents),amountRight,baseline,23,10,true);y+=height;
    });
    const adjustments=[['Subtotal',totals.subtotalCents],...(totals.discountCents?[[`Discount (${d.discountPercent}%)`,-totals.discountCents]]:[]),...(totals.taxCents?[[`Tax (${d.taxPercent}%)`,totals.taxCents]]:[])];
    y+=6;space(adjustments.length*6.5+22);
    for(const [label,value] of adjustments){text(label,110,y,9,false,muted);fitText(money(value),amountRight,y,36,9.5,true);y+=6.5;}
    pdf.setFillColor(...ink);pdf.roundedRect(106,y-1,86,13,1.5,1.5,'F');text('TOTAL DUE',110,y+7,9,true,[255,255,255]);fitText(money(totals.totalCents),amountRight,y+7,40,11,true,[255,255,255]);y+=20;

    function paymentIcon(x,baseline,bank=false){
      pdf.setDrawColor(...ink);pdf.setLineWidth(.35);
      if(bank){pdf.triangle(x,baseline-2.3,x+2.3,baseline-4,x+4.6,baseline-2.3,'S');for(const shift of [.8,2.3,3.8])pdf.line(x+shift,baseline-2,x+shift,baseline+.2);pdf.line(x,baseline+.6,x+4.6,baseline+.6);}
      else{pdf.roundedRect(x,baseline-3.2,4.8,3.7,.5,.5,'S');pdf.line(x,baseline-2,x+4.8,baseline-2);}
    }
    const paymentGroups=engine.paymentRows(d.payment).map(group=>{
      const rows=(group.rows.length?group.rows:[{label:'Instructions',value:''}]).map(row=>({...row,labelLines:wrap(row.label,40,8.5),valueLines:wrap(row.value,80,9)}));
      rows.forEach(row=>{row.height=Math.max(10,row.labelLines.length*3.8+5,row.valueLines.length*4+5);});
      const method=wrap(group.method,23,9,true),minimum=method.length*4+9,total=rows.reduce((sum,row)=>sum+row.height,0);
      if(total<minimum)rows[rows.length-1].height+=minimum-total;
      return {method,bank:/wise|bank/i.test(group.method),rows,height:rows.reduce((sum,row)=>sum+row.height,0)};
    });
    function paymentHeader(){
      space(29);paymentIcon(left,y+3);text('PAYMENT OPTIONS',left+7,y+3.2,8.5,true);y+=7;
      pdf.setFillColor(...tint);pdf.rect(left,y,width,9,'F');
      text('METHOD',left+4,y+6,8,true,muted);text('ACCOUNT / DETAIL',60,y+6,8,true,muted);text('INFORMATION',108,y+6,8,true,muted);y+=9;
    }
    space(16+(paymentGroups[0]?.height || 10));paymentHeader();
    for(const group of paymentGroups){
      let offset=0;
      while(offset<group.rows.length){
        const methodHeight=group.method.length*4+9;
        if(y+Math.max(group.rows[offset].height,methodHeight)>bottom){nextPage();paymentHeader();}
        if(group.rows[offset].height>bottom-y){
          const row=group.rows[offset],count=Math.max(1,Math.floor((bottom-y-5)/4));
          const first={...row,labelLines:row.labelLines.slice(0,count),valueLines:row.valueLines.slice(0,count)};
          first.height=Math.max(10,first.labelLines.length*3.8+5,first.valueLines.length*4+5);
          const remainder={...row,labelLines:row.labelLines.length>count?row.labelLines.slice(count):wrap(`${row.label} (continued)`,40,8.5),valueLines:row.valueLines.slice(count)};
          remainder.height=Math.max(10,remainder.labelLines.length*3.8+5,remainder.valueLines.length*4+5);
          group.rows.splice(offset,1,first,remainder);
        }
        const segment=[];let height=0;
        while(offset<group.rows.length && y+Math.max(height+group.rows[offset].height,methodHeight)<=bottom){const row={...group.rows[offset++]};segment.push(row);height+=row.height;}
        const segmentHeight=Math.max(height,methodHeight);segment[segment.length-1].height+=segmentHeight-height;
        const top=y;pdf.setDrawColor(...border);pdf.setLineWidth(.2);pdf.rect(left,top,width,segmentHeight,'S');pdf.line(56,top,56,top+segmentHeight);pdf.line(104,top,104,top+segmentHeight);
        paymentIcon(left+4,top+7,group.bank);text(group.method,left+11,top+7,9,true);
        for(let index=0;index<segment.length;index++){
          const row=segment[index];if(index)rule(y,56,right);
          text(row.labelLines,60,y+6,8.5,false,muted,{lineHeightFactor:1.25});text(row.valueLines,108,y+6,9,false,ink,{lineHeightFactor:1.25});
          if(/^https?:\/\//i.test(row.value))pdf.link(108,y+2,80,row.height-3,{url:row.value});y+=row.height;
        }
      }
    }
    const notes=[];
    if(!/payment\s+is\s+due|payment\s+due/i.test(d.notes || ''))notes.push(`Payment due ${engine.formatDate(d.dueDate)}.`);
    if(d.notes)notes.push(d.notes);
    const terms=wrap(notes.join('\n') || 'Thank you for your business.',width-10,9),termsHeight=terms.length*4+13;
    y+=6;space(termsHeight);pdf.setFillColor(...tint);pdf.roundedRect(left,y,width,termsHeight,2,2,'F');
    text('NOTES & TERMS',left+5,y+6,8,true,muted);text(terms,left+5,y+12,9,false,ink,{lineHeightFactor:1.25});

    const pages=pdf.getNumberOfPages();
    for(let page=1;page<=pages;page++){
      pdf.setPage(page);rule(280);text(d.sample?'DESIGN SAMPLE - NOT FOR PAYMENT':'Thank you for your business.',left,286,8,false,muted);
      text(`${page} / ${pages}`,right,286,8,false,muted,{align:'right'});
    }
    pdf.setProperties({title:`Invoice ${d.invoiceNumber}`,author:d.issuer.name,subject:d.sample?'Invoice design sample':'Invoice'});
    return pdf;
  }
  return {create};
});
