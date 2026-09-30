from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User, UserAddress, UserLanguage, UserProfile


class UserProfileInline(admin.StackedInline):
    model = UserProfile
    can_delete = False


class UserAddressInline(admin.TabularInline):
    model = UserAddress
    extra = 0


class UserLanguageInline(admin.TabularInline):
    model = UserLanguage
    extra = 0


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ['username', 'email', 'full_name', 'role', 'is_active']
    list_filter = ['role', 'is_active', 'is_staff']
    search_fields = ['username', 'email', 'profile__first_name', 'profile__last_name']
    ordering = ['username']
    inlines = [UserProfileInline, UserAddressInline, UserLanguageInline]
    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        ('Account', {'fields': ('email', 'role', 'is_active')}),
        ('Permissions', {'fields': ('is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('Dates', {'fields': ('last_login', 'date_joined')}),
    )
    add_fieldsets = (
        (None, {'classes': ('wide',), 'fields': ('username', 'email', 'role', 'password1', 'password2')}),
    )

    @admin.display(description='Name')
    def full_name(self, obj):
        return obj.get_full_name()
