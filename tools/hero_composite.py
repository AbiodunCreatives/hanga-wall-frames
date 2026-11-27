"""Composite three Hanga prints into the three frames on the wall of the homepage hero photo.
Source: git show e66d8ac:images/hero-bg.jpg (original stock wall photo)."""
import sys, subprocess, io
import numpy as np
from PIL import Image, ImageFilter, ImageOps, ImageDraw
REPO='/workspace/hanga-wall-frames'
base=Image.open(io.BytesIO(subprocess.check_output(['git','-C',REPO,'show','e66d8ac:images/hero-bg.jpg']))).convert('RGB')
W,H=base.size
# inner edges of the three gold frames (full-res px), measured from the photo
FRAMES=[(513,87,763,440),(840,85,1086,438),(1165,82,1412,436)]
ARTS=sys.argv[1:4]
out=base.copy()
for (x0,y0,x1,y1),src in zip(FRAMES,ARTS):
    fw,fh=x1-x0,y1-y0
    # mat: colour sampled from the original mat strip just inside the frame
    strip=np.asarray(base.crop((x0+4,y0+60,x0+18,y1-60))).reshape(-1,3)
    matc=tuple(int(v) for v in np.median(strip,0))
    mat=Image.new('RGB',(fw,fh),matc)
    # carry over the photo's soft lighting falloff across the mat (low-frequency)
    light=base.crop((x0,y0,x1,y1)).convert('L').resize((4,4)).resize((fw,fh),Image.BICUBIC)
    lightarr=np.asarray(light).astype(float); lightarr=lightarr/np.median(lightarr)
    lightarr=0.85+0.15*np.clip(lightarr,0.85,1.15)  # gentle
    m=28  # mat margin, same as the original prints
    aw,ah=fw-2*m,fh-2*m
    # optional crop focus: path@cx,cy (0..1), e.g. car.jpg@0.5,0.3
    cen=(0.5,0.5)
    if '@' in src: src,c=src.rsplit('@',1); cen=tuple(float(v) for v in c.split(','))
    art=ImageOps.fit(Image.open(src).convert('RGB'),(aw,ah),Image.LANCZOS,centering=cen)
    mat.paste(art,(m,m))
    # thin bevel line around the art window
    d=ImageDraw.Draw(mat); d.rectangle((m-1,m-1,m+aw,m+ah),outline=tuple(max(0,c-35) for c in matc))
    arr=np.asarray(mat).astype(float)*lightarr[...,None]
    # inner shadow cast by the frame (top + left stronger, like the room light)
    yy,xx=np.mgrid[0:fh,0:fw]
    sh=np.ones((fh,fw))
    sh*=1-0.22*np.exp(-yy/9.0)-0.14*np.exp(-xx/9.0)-0.08*np.exp(-(fw-1-xx)/7.0)-0.08*np.exp(-(fh-1-yy)/7.0)
    arr*=sh[...,None]
    # faint glass sheen: diagonal highlight
    sheen=np.clip(1-np.abs((xx/fw)-(yy/fh)*0.6-0.25)*3,0,1)*10
    arr=np.clip(arr+sheen[...,None],0,255).astype('uint8')
    out.paste(Image.fromarray(arr),(x0,y0))
out.save(REPO+'/images/hero-bg.jpg',quality=82,optimize=True,progressive=True)
out.save(REPO+'/images/hero-bg.webp',quality=80,method=6)
out.resize((960,640),Image.LANCZOS).save(REPO+'/images/hero-bg-960.webp',quality=78,method=6)
print('ok')
