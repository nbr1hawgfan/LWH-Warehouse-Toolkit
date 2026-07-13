window.LWHQR={
  make(el,text,size=100){el.innerHTML=''; if(!text)return; new QRCode(el,{text:String(text),width:size,height:size,correctLevel:QRCode.CorrectLevel.M});},
  vcard(c){
    const esc=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
    return ['BEGIN:VCARD','VERSION:3.0',`FN:${esc(c.name)}`,`ORG:${esc(c.company)}`,`TITLE:${esc(c.title)}`,`TEL:${esc(c.phone)}`,`EMAIL:${esc(c.email)}`,`URL:${esc(c.website)}`,`ADR:;;${esc(c.street)};${esc(c.city)};${esc(c.state)};${esc(c.zip)};`,'END:VCARD'].join('\n');
  }
};
