import { expect, it } from 'vitest';
import { readGlyphForm } from '$lib/tunes/import/pdf-glyph-form';
import type { SystemGeometry } from '$lib/tunes/import/pdf-geometry';
const geometry:SystemGeometry={band:{top:100,bottom:180,lines:[100,120,140,160,180]},interline:20,firstBarLeft:100,barlines:[200,400],repeatDots:[{left:true,right:true},{left:false,right:false}],initialRepeat:true};
const item=(str:string,x:number,y:number)=>({str,x,y,w:12,h:80});
const texts={chords:[],marks:[],endings:[],barNumber:null};
it('reads bare ending numbers only with a matching printed bracket and pairs repeat dots',()=>{
 const items=[item('\ue0a4',120,160),item('1',212,40),item('\ue044',375,150),item('\ue044',375,130)];
 const result=readGlyphForm(geometry,items,texts,[{points:[[200,40],[200,0],[390,0]],curved:false,filled:false,width:2}]);
 expect(result.texts.endings).toEqual([{x:212,n:1,endX:390}]);
 expect(result.geometry.repeatDots).toEqual([{left:false,right:false},{left:true,right:false}]);
 expect(result.geometry.initialRepeat).toBe(false);
});
it('does not reinterpret isolated numbers or change a scan without notation glyphs',()=>{
 expect(readGlyphForm(geometry,[item('1',212,40)],texts,[])).toEqual({geometry,texts});
 expect(readGlyphForm(geometry,[item('\ue0a4',120,160),item('1',212,40)],texts,[]).texts.endings).toEqual([]);
});
