'use client'
import { useState, useCallback, useEffect, useLayoutEffect, memo } from 'react'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Globe, Mail, CloudDownload, LoaderCircle, Trash, Box } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Card, CardHeader, CardContent, CardFooter, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/components/ui/use-toast'
import ResponsiveDialog from '@/components/ResponsiveDialog'
import SearchBar from '@/components/SearchBar'
import { usePluginStore } from '@/store/plugin'
import { useSettingStore } from '@/store/setting'
import { encodeToken } from '@/utils/signature'
import { isUndefined, find, snakeCase } from 'lodash-es'

type PluginStoreProps = {
  open: boolean
  onClose: () => void
}

const pluginManifestSchema = z.object({
  name_for_human: z.string(),
  name_for_model: z.string(),
  description_for_human: z.string(),
  description_for_model: z.string(),
  api: z.object({
    is_user_authenticated: z.boolean(),
    type: z.string(),
    url: z.string().url(),
  }),
  logo_url: z.string().url(),
  contact_email: z.string().email(),
  legal_info_url: z.string().url(),
  schema_version: z.string(),
})

const deafultCustomPlugin = {
  name_for_human: 'Plugin Title',
  name_for_model: 'plugin_title',
  description_for_human: 'This is Plugin Description.',
  description_for_model: 'This is Plugin Description.',
  api: {
    is_user_authenticated: false,
    type: 'openapi',
    url: '',
  },
  auth: {
    type: 'none',
  },
  logo_url: '',
  contact_email: '',
  legal_info_url: '',
  schema_version: '',
}

async function loadPluginManifest(url: string, useProxy = false, token = '') {
  let response
  if (useProxy) {
    response = await fetch(`/api/gateway?token=${token}`, {
      method: 'POST',
      body: JSON.stringify({ baseUrl: url }),
    })
  } else {
    response = await fetch(url)
  }
  const contentType = response.headers.get('Content-Type')
  try {
    if (contentType === 'application/json') {
      return await response.json()
    } else {
      const { default: YAML } = await import('yaml')
      const yaml = await response.text()
      return YAML.parse(yaml)
    }
  } catch {
    throw new TypeError('urlError')
  }
}

function search(keyword: string, data: PluginManifest[]): PluginManifest[] {
  const results: PluginManifest[] = []
  // 'i' means case-insensitive
  const regex = new RegExp(keyword.trim(), 'gi')
  data.forEach((item) => {
    if (
      regex.test(item.name_for_model) ||
      regex.test(item.name_for_human) ||
      regex.test(item.description_for_model) ||
      regex.test(item.description_for_human)
    ) {
      results.push(item)
    }
  })
  return results
}

function PluginMarket({ open, onClose }: PluginStoreProps) {
  const { password } = useSettingStore()
  const { plugins, tools, installed, addPlugin, removePlugin, installPlugin, uninstallPlugin, removeTool } =
    usePluginStore()
  const { t } = useTranslation()
  const { toast } = useToast()
  const [pluginList, setPluginList] = useState<PluginManifest[]>([])
  const [storePlugins, setStorePlugins] = useState<string[]>([])
  const [loadingList, setLoadingList] = useState<string[]>([])
  const [manifestUrl, setManifestUrl] = useState<string>('')
  const [useProxy, setUseProxy] = useState<boolean>(false)
  const [customPlugin, setCustomPlugin] = useState<PluginManifest>(deafultCustomPlugin)
  const [pluginDetail, setPluginDetail] = useState<string>('')
  const [currentTab, setCurrentTab] = useState<string>('list')

  const handleClose = useCallback(() => {
    onClose()
    if (plugins.length > 0) setPluginList(plugins)
  }, [plugins, onClose])

  const handleSearch = useCallback(
    (keyword: string) => {
      const result = search(keyword, plugins)
      setPluginList(result)
    },
    [plugins],
  )

  const handleClear = useCallback(() => {
    setPluginList(plugins)
  }, [plugins])

  const handleInstall = useCallback(
    async (id: string) => {
      const manifest = find(pluginList, { name_for_model: id })
      if (isUndefined(manifest)) {
        throw new Error('Manifest not found!')
      }
      loadingList.push(id)
      setLoadingList([...loadingList])
      const token = encodeToken(password)
      const response = await fetch(`/api/plugins?token=${token}`, {
        method: 'POST',
        body: manifest.api.url,
      })
      const result: OpenAPIDocument = await response.json()
      if (result.paths) {
        installPlugin(id, result)
      } else {
        toast({
          title: t('pluginLoadingFailed'),
          description: t('pluginLoadingFailedDesc'),
        })
      }
      setLoadingList(loadingList.filter((pluginId) => pluginId !== id))
    },
    [password, loadingList, pluginList, installPlugin, toast, t],
  )

  const handleUninstall = useCallback(
    (id: string) => {
      tools.forEach((tool) => {
        const toolPrefix = `${id}__`
        if (tool.name.startsWith(toolPrefix)) {
          removeTool(tool.name)
        }
      })
      uninstallPlugin(id)
    },
    [tools, uninstallPlugin, removeTool],
  )

  const handleRemove = useCallback(
    (id: string) => {
      handleUninstall(id)
      removePlugin(id)
    },
    [handleUninstall, removePlugin],
  )

  const handleLoadPlugin = useCallback(
    async (url: string) => {
      const token = encodeToken(password)
      const manifest = await loadPluginManifest(url, useProxy, token)
      const parser = pluginManifestSchema.safeParse(manifest)
      if (!parser.success) {
        throw new TypeError('OpenAPI Manifest Invalid', { cause: parser.error })
      }
      setCustomPlugin(parser.data as PluginManifest)
      const response = await fetch(`/api/plugins?token=${token}`, {
        method: 'POST',
        body: manifest.api.url,
      })
      const result: OpenAPIDocument = await response.json()
      if (result.paths) {
        setPluginDetail(JSON.stringify(result, null, 4))
      }
    },
    [password, useProxy],
  )

  const handleAddPlugin = async () => {
    if (pluginDetail === '') {
      toast({
        title: t('pluginLoadingFailed'),
        description: '插件配置内容缺失',
      })
      return false
    }
    const token = encodeToken(password)
    const response = await fetch(`/api/plugins?token=${token}`, {
      method: 'POST',
      body: pluginDetail,
    })
    if (response.status === 200) {
      const result: OpenAPIDocument = await response.json()
      installPlugin(customPlugin.name_for_model, result)
      if (customPlugin.api.url === '') {
        try {
          const pluginConfig: OpenAPIDocument = JSON.parse(pluginDetail)
          const manifest = {
            name_for_human: pluginConfig.info.title,
            name_for_model: snakeCase(pluginConfig.info.title),
            description_for_human: pluginConfig.info.description || pluginConfig.info.title,
            description_for_model: pluginConfig.info.description || pluginConfig.info.title,
            api: {
              is_user_authenticated: false,
              type: 'openapi',
              url: '',
            },
            auth: {
              type: 'none',
            },
            logo_url: '',
            contact_email: pluginConfig.info.contact?.email || '',
            legal_info_url: pluginConfig.info.termsOfService || '',
            schema_version: pluginConfig.info.version,
          }
          setCustomPlugin(manifest)
          addPlugin(manifest)
          setCurrentTab('list')
          setCustomPlugin(deafultCustomPlugin)
          setPluginDetail('')
        } catch (err) {
          toast({
            title: t('pluginLoadingFailed'),
            description: t('pluginLoadingFailedDesc'),
          })
        }
      } else {
        addPlugin(customPlugin)
        setCurrentTab('list')
        setCustomPlugin(deafultCustomPlugin)
        setPluginDetail('')
      }
    } else {
      const result: ErrorResponse = await response.json()
      toast({
        title: t('pluginLoadingFailed'),
        description: result.message,
      })
    }
  }

  useEffect(() => usePluginStore.subscribe((state) => setPluginList(state.plugins)), [])

  useLayoutEffect(() => {
    if (open && pluginList.length === 0) {
      fetch('/plugins/store.json').then(async (response) => {
        const data: PluginManifest[] = await response.json()
        const storePluginList: string[] = []
        data.forEach((manifest) => {
          storePluginList.push(manifest.name_for_model)
          if (!find(plugins, { name_for_model: manifest.name_for_model })) {
            addPlugin(manifest)
          }
        })
        setPluginList(plugins)
        setStorePlugins(storePluginList)
      })
    }
  }, [open, addPlugin, plugins, pluginList])

  return (
    <ResponsiveDialog
      className="max-w-screen-md"
      open={open}
      onClose={handleClose}
      title={t('pluginMarket')}
      description={t('pluginMarketDesc')}
    >
      <Tabs value={currentTab} onValueChange={(value) => setCurrentTab(value)}>
        <TabsList className="mx-auto grid w-full grid-cols-2">
          <TabsTrigger value="list">插件列表</TabsTrigger>
          <TabsTrigger value="custom">自定义插件</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <div className="my-4 max-sm:my-2">
            <SearchBar onSearch={handleSearch} onClear={() => handleClear()} />
          </div>
          <ScrollArea className="h-[400px] w-full scroll-smooth">
            <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
              {pluginList.map((item) => {
                return (
                  <Card key={item.name_for_model} className="transition-colors dark:hover:border-white/80">
                    <CardHeader className="pb-1 pt-4">
                      <CardTitle className="flex truncate text-base font-medium">
                        <Avatar className="mr-0.5 h-6 w-6 p-1">
                          <AvatarImage className="h-4 w-4 rounded-full" src={item.logo_url} alt={item.name_for_human} />
                          <AvatarFallback>
                            <Box className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                        {item.name_for_human}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-line-clamp-3 h-16 pb-2 text-sm">
                      {item.description_for_human}
                    </CardContent>
                    <CardFooter className="flex justify-between px-4 pb-2">
                      <div>
                        {customPlugin.legal_info_url ? (
                          <a href={item.legal_info_url} title={item.legal_info_url} target="_blank">
                            <Button className="h-8 w-8" size="icon" variant="ghost">
                              <Globe className="h-5 w-5" />
                            </Button>
                          </a>
                        ) : null}
                        {customPlugin.contact_email ? (
                          <a href={`mailto:${item.contact_email}`} title={item.contact_email} target="_blank">
                            <Button className="h-8 w-8" size="icon" variant="ghost">
                              <Mail className="h-5 w-5" />
                            </Button>
                          </a>
                        ) : null}
                      </div>
                      <div>
                        {storePlugins.indexOf(item.name_for_model) === -1 ? (
                          <Button
                            className="mr-2 h-8"
                            variant="outline"
                            onClick={() => handleRemove(item.name_for_model)}
                          >
                            {t('delete')}
                          </Button>
                        ) : null}
                        {item.api.url !== '' ? (
                          <Button
                            className="h-8 bg-red-400 hover:bg-red-500"
                            disabled={loadingList.includes(item.name_for_model)}
                            onClick={() =>
                              item.name_for_model in installed
                                ? handleUninstall(item.name_for_model)
                                : handleInstall(item.name_for_model)
                            }
                          >
                            {item.name_for_model in installed ? (
                              <>
                                {`${t('uninstall')} `}
                                {loadingList.includes(item.name_for_model) ? (
                                  <LoaderCircle className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash className="h-4 w-4" />
                                )}
                              </>
                            ) : (
                              <>
                                {`${t('install')} `}
                                {loadingList.includes(item.name_for_model) ? (
                                  <LoaderCircle className="h-4 w-4 animate-spin" />
                                ) : (
                                  <CloudDownload className="h-4 w-4" />
                                )}
                              </>
                            )}
                          </Button>
                        ) : null}
                      </div>
                    </CardFooter>
                  </Card>
                )
              })}
            </div>
            <ScrollBar orientation="vertical" />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="custom">
          <div>
            <div className="mb-3 mt-4 flex w-full gap-2 max-sm:my-2">
              <Input placeholder={t('pluginUrlPlaceholder')} onChange={(ev) => setManifestUrl(ev.target.value)} />
              <Button type="submit" onClick={() => handleLoadPlugin(manifestUrl)}>
                加载配置
              </Button>
            </div>
            <div className="mb-3 flex gap-2">
              <Checkbox id="proxy" onCheckedChange={(checkedState) => setUseProxy(!!checkedState)} />
              <label htmlFor="proxy" className="text-sm font-medium leading-4">
                服务器代理（如遇到跨域问题，请尝试开启该选项后重新加载配置）
              </label>
            </div>
          </div>
          <div className="mb-3">
            <Card className="transition-colors dark:hover:border-white/80">
              <CardHeader className="px-4 pb-1 pt-3">
                <CardTitle className="inline-flex justify-between truncate text-base font-medium">
                  <div className="inline-flex">
                    <Avatar className="mr-0.5 h-6 w-6 p-1">
                      <AvatarImage
                        className="h-4 w-4 rounded-full"
                        src={customPlugin.logo_url}
                        alt={customPlugin.name_for_human}
                      />
                      <AvatarFallback>
                        <Box className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                    {customPlugin.name_for_human}
                  </div>
                  <div className="inline-flex gap-1">
                    {customPlugin.legal_info_url ? (
                      <a href={customPlugin.legal_info_url} title={customPlugin.legal_info_url} target="_blank">
                        <Button className="h-6 w-6 [&_svg]:size-4" size="icon" variant="ghost">
                          <Globe />
                        </Button>
                      </a>
                    ) : null}
                    {customPlugin.contact_email ? (
                      <a
                        href={`mailto:${customPlugin.contact_email}`}
                        title={customPlugin.contact_email}
                        target="_blank"
                      >
                        <Button className="h-6 w-6 [&_svg]:size-4" size="icon" variant="ghost">
                          <Mail />
                        </Button>
                      </a>
                    ) : null}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-1 text-sm">
                <p className="whitespace-pre-wrap">{customPlugin.description_for_human}</p>
              </CardContent>
            </Card>
          </div>
          <div>
            <Textarea
              className="h-[238px] whitespace-pre-wrap max-sm:h-[210px]"
              placeholder="插件配置内容（仅支持 openAPI 3.0 以上版本）"
              value={pluginDetail}
              onChange={(ev) => setPluginDetail(ev.target.value)}
            />
            <div className="mt-2 flex justify-end gap-2 max-sm:mb-2 max-sm:justify-center">
              <Button className="max-sm:flex-1" type="button" variant="secondary" onClick={() => setPluginDetail('')}>
                清空
              </Button>
              <Button className="max-sm:flex-1" type="submit" onClick={() => handleAddPlugin()}>
                {t('addPlugin')}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </ResponsiveDialog>
  )
}

export default memo(PluginMarket)