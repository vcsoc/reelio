/* Owned-window Wayland regression input. No input is sent unless focus/cursor match. */
#include <wayland-client.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
static struct wl_proxy *manager;
static const struct wl_interface pointer_interface;
static const struct wl_interface *create_types[] = { &wl_seat_interface, &pointer_interface };
static const struct wl_message manager_requests[] = {{"create_virtual_pointer", "?on", create_types}};
static const struct wl_interface manager_interface = {"zwlr_virtual_pointer_manager_v1",1,1,manager_requests,0,NULL};
static const struct wl_message pointer_requests[] = {{"motion","uff",NULL},{"motion_absolute","uuuuu",NULL},{"button","uuu",NULL},{"axis","uuf",NULL},{"frame","",NULL}};
static const struct wl_interface pointer_interface = {"zwlr_virtual_pointer_v1",1,5,pointer_requests,0,NULL};
static void global(void *data, struct wl_registry *registry, uint32_t name, const char *interface, uint32_t version) {
 (void)data; (void)version;
 if (!strcmp(interface,manager_interface.name)) manager=wl_registry_bind(registry,name,&manager_interface,1);
}
static void removed(void *data, struct wl_registry *registry,uint32_t name){(void)data;(void)registry;(void)name;}
static unsigned stamp(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return (unsigned)(t.tv_sec*1000+t.tv_nsec/1000000);}
static int owns_focus(int pid) {
 FILE *f=popen("hyprctl -j activewindow","r"); if(!f)return 0;
 char text[16384];size_t size=fread(text,1,sizeof(text)-1,f);text[size]=0;pclose(f);
 char *field=strstr(text,"\"pid\":");int actual=-1;
 return field && sscanf(field+6," %d",&actual)==1 && actual==pid;
}
static int cursor_matches(int x,int y) {
 FILE *f=popen("hyprctl cursorpos","r");if(!f)return 0;int ax=-999999,ay=-999999;
 int parsed=fscanf(f,"%d, %d",&ax,&ay);pclose(f);return parsed==2 && abs(ax-x)<=2 && abs(ay-y)<=2;
}
static void motion(struct wl_proxy *p,struct wl_display *d,int x,int y,int left,int top,int width,int height) {
 wl_proxy_marshal_flags(p,1,NULL,1,0,stamp(),(unsigned)(x-left),(unsigned)(y-top),(unsigned)width,(unsigned)height);
 wl_proxy_marshal_flags(p,4,NULL,1,0);wl_display_roundtrip(d);
}
static void button(struct wl_proxy *p,struct wl_display *d,int state) {
 wl_proxy_marshal_flags(p,2,NULL,1,0,stamp(),272,state);wl_proxy_marshal_flags(p,4,NULL,1,0);wl_display_roundtrip(d);
}
int main(int argc,char **argv) {
 if(argc!=10)return 2;
 int sx=atoi(argv[1]),sy=atoi(argv[2]),ex=atoi(argv[3]),ey=atoi(argv[4]),left=atoi(argv[5]),top=atoi(argv[6]),width=atoi(argv[7]),height=atoi(argv[8]),pid=atoi(argv[9]);
 if(width<=0 || height<=0 || !owns_focus(pid))return 3;
 struct wl_display *d=wl_display_connect(NULL);if(!d)return 4;
 struct wl_registry *r=wl_display_get_registry(d);struct wl_registry_listener listener={global,removed};wl_registry_add_listener(r,&listener,NULL);wl_display_roundtrip(d);if(!manager)return 5;
 struct wl_proxy *p=wl_proxy_marshal_flags(manager,0,&pointer_interface,1,0,NULL,NULL);
 motion(p,d,sx,sy,left,top,width,height);usleep(150000);
 if(!owns_focus(pid) || !cursor_matches(sx,sy))return 6;
 button(p,d,1);usleep(100000);
 int success=1;
 for(int step=1;step<=12;step++) {
  if(!owns_focus(pid)){success=0;break;}
  motion(p,d,sx+(ex-sx)*step/12,sy+(ey-sy)*step/12,left,top,width,height);usleep(30000);
 }
 button(p,d,0);usleep(150000);wl_display_disconnect(d);
 return success ? 0 : 7;
}
