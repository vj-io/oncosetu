def lum(h):
    h=h.lstrip('#'); r,g,b=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    f=lambda c: c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)
def cr(a,b):
    la,lb=lum(a),lum(b); 
    if la<lb: la,lb=lb,la
    return (la+0.05)/(lb+0.05)
pairs=[
("ink on surface","#17212B","#FFFFFF"),("ink on canvas","#17212B","#F3F6F8"),
("muted on surface","#5D6B78","#FFFFFF"),("muted on canvas","#5D6B78","#F3F6F8"),
("white on brand","#FFFFFF","#0F6E78"),("brand on surface (links)","#0F6E78","#FFFFFF"),("brand on canvas","#0F6E78","#F3F6F8"),
("amber text on tint","#B45309","#FEF3E2"),("amber on surface","#B45309","#FFFFFF"),
("rose on tint","#B4233C","#FDECEE"),("green on tint","#1E7A4C","#E7F5EC"),("info on tint","#2459A6","#EAF1FB"),
("brand on teal tint","#0F6E78","#E3F1F2"),
("slate panel text #E6EEF3","#E6EEF3","#0E1A22"),("slate muted #9FB2BF","#9FB2BF","#0E1A22"),
("white on ink button","#FFFFFF","#17212B"),
]
for n,f,b in pairs: print(f"{n:32} {f} on {b}  {cr(f,b):.2f}")
